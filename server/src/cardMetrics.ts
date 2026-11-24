import { SQL } from "bun";
import type { Logger } from "../../shared/logging";
import type { RoomMode, SwapCost } from "../../shared/protocol";
import { logger as defaultLogger } from "./logger";

export const CARD_METRICS_FLUSH_INTERVAL_MS = 5 * 60_000;
export const CARD_METRICS_SHUTDOWN_TIMEOUT_MS = 10_000;
const MAX_BACKOFF_MS = 60 * 60_000;
const FAILURES_BEFORE_ERROR = 5;
const DATABASE_TIMEOUT_SECONDS = 10;
const DATABASE_IDLE_TIMEOUT_SECONDS = 60;

/** Partidas de teste ficam em tabela própria: servem só para conferir que o fluxo chega ao banco. */
export const CARD_METRICS_TABLES = {
  private: "card_metrics",
  test: "card_metrics_test",
} as const satisfies Record<RoomMode, string>;
// Object.keys perde o tipo das chaves; a tabela acima é exaustiva por `satisfies`.
const ROOM_MODES = Object.keys(CARD_METRICS_TABLES) as RoomMode[];

export interface CardCounts { dealt: number; freeSwaps: number; paidSwaps: number }
export interface CardMetricsRow extends CardCounts { cardId: string }
export type CardMetricsBatch = Record<RoomMode, CardMetricsRow[]>;
export type CardMetricsSink = (batch: CardMetricsBatch) => Promise<void>;

export interface CardMetricsRecorder {
  recordDealt(mode: RoomMode, cardIds: readonly string[]): void;
  recordSwap(mode: RoomMode, cardId: string, cost: SwapCost): void;
}

export const NOOP_CARD_METRICS: CardMetricsRecorder = {
  recordDealt() { /* Coleta desligada sem banco configurado. */ },
  recordSwap() { /* Coleta desligada sem banco configurado. */ },
};

const SWAP_COUNTERS = {
  free: "freeSwaps",
  point: "paidSwaps",
} as const satisfies Record<SwapCost, keyof CardCounts>;

type Buffers = Record<RoomMode, Map<string, CardCounts>>;

function emptyBuffers(): Buffers {
  return { private: new Map(), test: new Map() };
}

function countsFor(buffer: Map<string, CardCounts>, cardId: string): CardCounts {
  let counts = buffer.get(cardId);
  if (!counts) {
    counts = { dealt: 0, freeSwaps: 0, paidSwaps: 0 };
    buffer.set(cardId, counts);
  }
  return counts;
}

function toRows(buffer: Map<string, CardCounts>): CardMetricsRow[] {
  return [...buffer].map(([cardId, counts]) => ({ cardId, ...counts }));
}

function batchSize(batch: CardMetricsBatch): number {
  return batch.private.length + batch.test.length;
}

function backoffMs(failures: number): number {
  return Math.min(CARD_METRICS_FLUSH_INTERVAL_MS * 2 ** (failures - 1), MAX_BACKOFF_MS);
}

/**
 * Agrega contagens em memória (síncrono, O(1) por evento) e envia em lote ao sink.
 * O tamanho dos mapas é limitado pelo catálogo, por isso uma falha nunca descarta dados.
 */
export function createCardMetrics(options: { sink: CardMetricsSink; logger?: Logger; now?: () => number }) {
  const logger = options.logger ?? defaultLogger;
  const now = options.now ?? Date.now;
  let buffers = emptyBuffers();
  let flushing: Promise<void> | null = null;
  let consecutiveFailures = 0;
  let retryAt = 0;

  const recorder: CardMetricsRecorder = {
    recordDealt(mode, cardIds) {
      for (const cardId of cardIds) countsFor(buffers[mode], cardId).dealt += 1;
    },
    recordSwap(mode, cardId, cost) {
      countsFor(buffers[mode], cardId)[SWAP_COUNTERS[cost]] += 1;
    },
  };

  function takeBatch(): CardMetricsBatch {
    const taken = buffers;
    buffers = emptyBuffers();
    return { private: toRows(taken.private), test: toRows(taken.test) };
  }

  function restore(batch: CardMetricsBatch): void {
    for (const mode of ROOM_MODES) {
      for (const row of batch[mode]) {
        const counts = countsFor(buffers[mode], row.cardId);
        counts.dealt += row.dealt;
        counts.freeSwaps += row.freeSwaps;
        counts.paidSwaps += row.paidSwaps;
      }
    }
  }

  function registerFailure(batch: CardMetricsBatch, error: unknown): void {
    restore(batch);
    consecutiveFailures += 1;
    retryAt = now() + backoffMs(consecutiveFailures);
    const fields = { cardCount: batchSize(batch), attempt: consecutiveFailures, delayMs: retryAt - now() };
    if (consecutiveFailures >= FAILURES_BEFORE_ERROR) logger.error("card_metrics.flush_failed", fields, error);
    else logger.warn("card_metrics.flush_failed", fields);
  }

  async function send(force: boolean): Promise<void> {
    if (!force && now() < retryAt) return;
    const batch = takeBatch();
    if (batchSize(batch) === 0) return;
    const startedAt = performance.now();
    try {
      await options.sink(batch);
    } catch (error) {
      registerFailure(batch, error);
      return;
    }
    consecutiveFailures = 0;
    retryAt = 0;
    logger.info("card_metrics.flushed", { cardCount: batchSize(batch), durationMs: Math.round(performance.now() - startedAt) });
  }

  /** Nunca rejeita. `force` ignora o backoff (usado no desligamento). */
  function flush(flushOptions: { force?: boolean } = {}): Promise<void> {
    flushing ??= send(flushOptions.force === true).finally(() => { flushing = null; });
    return flushing;
  }

  return { recorder, flush };
}

export type CardMetrics = ReturnType<typeof createCardMetrics>;

function toDatabaseRows(rows: readonly CardMetricsRow[]) {
  return rows.map(row => ({
    card_id: row.cardId, dealt_count: row.dealt, free_swap_count: row.freeSwaps, paid_swap_count: row.paidSwaps,
  }));
}

/** Postgres via Bun.SQL nativo: um UPSERT em lote por tabela, numa transação. */
export function createPostgresCardMetricsSink(url: string): { sink: CardMetricsSink; close: () => Promise<void> } {
  const sql = new SQL({ url, max: 1, connectionTimeout: DATABASE_TIMEOUT_SECONDS, idleTimeout: DATABASE_IDLE_TIMEOUT_SECONDS });
  let tablesReady: Promise<void> | null = null;

  async function createTables(): Promise<void> {
    for (const table of Object.values(CARD_METRICS_TABLES)) {
      await sql`CREATE TABLE IF NOT EXISTS ${sql(table)} (
        card_id text PRIMARY KEY,
        dealt_count bigint NOT NULL DEFAULT 0,
        free_swap_count bigint NOT NULL DEFAULT 0,
        paid_swap_count bigint NOT NULL DEFAULT 0,
        updated_at timestamptz NOT NULL DEFAULT now()
      )`;
    }
  }

  async function sink(batch: CardMetricsBatch): Promise<void> {
    // Uma falha na criação é tentada de novo no próximo flush.
    tablesReady ??= createTables().catch(error => { tablesReady = null; throw error; });
    await tablesReady;
    await sql.begin(async transaction => {
      // Tempo limite no servidor: a transação inteira faz rollback, então o lote pode ser reenviado sem contar duas vezes.
      await transaction`SELECT set_config('statement_timeout', ${`${DATABASE_TIMEOUT_SECONDS}s`}, true)`;
      for (const mode of ROOM_MODES) {
        if (!batch[mode].length) continue;
        const table = transaction(CARD_METRICS_TABLES[mode]);
        await transaction`INSERT INTO ${table} ${transaction(toDatabaseRows(batch[mode]))}
          ON CONFLICT (card_id) DO UPDATE SET
            dealt_count = ${table}.dealt_count + EXCLUDED.dealt_count,
            free_swap_count = ${table}.free_swap_count + EXCLUDED.free_swap_count,
            paid_swap_count = ${table}.paid_swap_count + EXCLUDED.paid_swap_count,
            updated_at = now()`;
      }
    });
  }

  return { sink, close: () => sql.close({ timeout: DATABASE_TIMEOUT_SECONDS }) };
}

function withTimeout(promise: Promise<void>, timeoutMs: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<void>(resolve => { timer = setTimeout(resolve, timeoutMs); });
  return Promise.race([promise, expired]).finally(() => clearTimeout(timer));
}

/** Liga a coleta quando há `DATABASE_URL`; sem ela, o jogo usa o recorder vazio. */
export function startCardMetrics(url: string | undefined, logger: Logger = defaultLogger): {
  recorder: CardMetricsRecorder; stop: () => Promise<void>;
} {
  if (!url?.trim()) {
    logger.info("card_metrics.disabled", { reason: "missing_database_url" });
    return { recorder: NOOP_CARD_METRICS, stop: () => Promise.resolve() };
  }
  const database = createPostgresCardMetricsSink(url.trim());
  const metrics = createCardMetrics({ sink: database.sink, logger });
  // flush nunca rejeita: falhas viram log e o lote volta ao buffer.
  const timer = setInterval(() => { void metrics.flush(); }, CARD_METRICS_FLUSH_INTERVAL_MS);
  logger.info("card_metrics.enabled", { delayMs: CARD_METRICS_FLUSH_INTERVAL_MS });

  async function finish(): Promise<void> {
    await metrics.flush({ force: true });
    await database.close().catch(() => logger.warn("card_metrics.close_failed"));
  }

  return {
    recorder: metrics.recorder,
    // Um banco lento não pode segurar o desligamento: o que não couber no prazo se perde.
    stop: () => {
      clearInterval(timer);
      return withTimeout(finish(), CARD_METRICS_SHUTDOWN_TIMEOUT_MS);
    },
  };
}
