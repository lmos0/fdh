import { describe, expect, test } from "bun:test";
import { createLogger } from "../../shared/logging";
import { SWAP_COST_POINTS, type RoomMode } from "../../shared/protocol";
import { BOT_SUBMIT_DELAY_MS } from "../src/bots";
import {
  CARD_METRICS_FLUSH_INTERVAL_MS, createCardMetrics, NOOP_CARD_METRICS, startCardMetrics,
  type CardMetricsBatch, type CardMetricsRow, type CardMetricsSink,
} from "../src/cardMetrics";
import { RESULT_DURATION_MS } from "../src/game";
import { errorCode, singleCatalog, table } from "./helpers";

type Harness = ReturnType<typeof table>;
const MAX_ROUNDS = 12;

function recordingSink() {
  const batches: CardMetricsBatch[] = [];
  const sink: CardMetricsSink = batch => {
    batches.push(structuredClone(batch));
    return Promise.resolve();
  };
  return { sink, batches };
}

function metricsTable(count: number, mode: RoomMode = "private", targetScore = 10) {
  let time = 0;
  const { sink, batches } = recordingSink();
  const metrics = createCardMetrics({ sink, logger: createLogger({ level: "silent" }), now: () => time });
  const h = table(count, targetScore, 50, singleCatalog, undefined, mode, null, 15, metrics.recorder);
  async function flush(): Promise<CardMetricsBatch> {
    time += CARD_METRICS_FLUSH_INTERVAL_MS;
    await metrics.flush();
    return batches.at(-1) ?? { private: [], test: [] };
  }
  return { h, flush, batches };
}

function totalDealt(rows: readonly CardMetricsRow[]): number {
  return rows.reduce((sum, row) => sum + row.dealt, 0);
}

function rowFor(rows: readonly CardMetricsRow[], cardId: string): CardMetricsRow | undefined {
  return rows.find(row => row.cardId === cardId);
}

function handIds(h: Harness, connection: string): string[] {
  return h.view(connection).self.hand.map(card => card.id);
}

function respondents(h: Harness): string[] {
  const judgeId = h.view().room.round!.judgePlayerId;
  return h.connections.filter(id => h.view(id).self.playerId !== judgeId);
}

function scoreOf(h: Harness, connection: string): number {
  const self = h.view(connection).self.playerId;
  return h.view(connection).room.players.find(player => player.id === self)!.score;
}

function swap(h: Harness, connection: string, cost: "free" | "point", cardId = handIds(h, connection)[0]!) {
  return h.command(connection, "round.swap", { roundId: h.view(connection).room.round!.id, cardId, cost });
}

function playRound(h: Harness): void {
  h.submitAll();
  const judge = h.judgeConnection();
  const round = h.view(judge).room.round!;
  h.command(judge, "round.judge", { roundId: round.id, optionId: round.options[0]!.id });
  h.tick(RESULT_DURATION_MS);
}

function playUntil(h: Harness, ready: () => boolean): void {
  for (let round = 0; round < MAX_ROUNDS && !ready(); round++) playRound(h);
  expect(ready()).toBe(true);
}

describe("métricas de cartas", () => {
  test("a mão inicial de cada pessoa conta como distribuída", async () => {
    const { h, flush } = metricsTable(3);
    h.command("c0", "game.start", {});

    const batch = await flush();

    const hands = h.connections.flatMap(connection => handIds(h, connection));
    expect(totalDealt(batch.private)).toBe(hands.length);
    for (const cardId of hands) expect(rowFor(batch.private, cardId)?.dealt).toBe(1);
    expect(batch.test).toEqual([]);
  });

  test("a reposição conta só as cartas novas", async () => {
    const { h, flush } = metricsTable(3);
    h.command("c0", "game.start", {});
    await flush();
    const pick = h.view().room.round!.prompt.pick;
    const submitted = respondents(h).length * pick;

    playRound(h);
    const batch = await flush();

    expect(totalDealt(batch.private)).toBe(submitted);
  });

  test("troca grátis conta o descarte pelo custo e a carta recebida como distribuída", async () => {
    const { h, flush } = metricsTable(3);
    h.command("c0", "game.start", {});
    await flush();
    const player = respondents(h)[0]!;
    const discarded = handIds(h, player)[0]!;

    expect(errorCode(swap(h, player, "free", discarded))).toBeUndefined();
    const batch = await flush();

    const received = handIds(h, player)[0]!;
    expect(rowFor(batch.private, discarded)).toEqual({ cardId: discarded, dealt: 0, freeSwaps: 1, paidSwaps: 0 });
    expect(rowFor(batch.private, received)).toEqual({ cardId: received, dealt: 1, freeSwaps: 0, paidSwaps: 0 });
  });

  test("troca paga conta separada da grátis", async () => {
    const { h, flush } = metricsTable(3);
    h.command("c0", "game.start", {});
    const withPoint = () => respondents(h).find(connection => scoreOf(h, connection) >= SWAP_COST_POINTS);
    playUntil(h, () => withPoint() !== undefined);
    const player = withPoint()!;
    while (h.view(player).self.freeSwapsRemaining > 0) swap(h, player, "free");
    await flush();
    const discarded = handIds(h, player)[0]!;

    expect(errorCode(swap(h, player, "point", discarded))).toBeUndefined();
    const batch = await flush();

    expect(rowFor(batch.private, discarded)).toMatchObject({ freeSwaps: 0, paidSwaps: 1 });
  });

  test("reiniciar a partida conta a nova mão inteira", async () => {
    const { h, flush } = metricsTable(3, "private", 3);
    h.command("c0", "game.start", {});
    playUntil(h, () => h.view().room.phase === "finished");
    await flush();

    h.command("c0", "game.restart", {});
    const batch = await flush();

    const hands = h.connections.flatMap(connection => handIds(h, connection));
    expect(totalDealt(batch.private)).toBe(hands.length);
  });

  test("partida de teste vai só para a tabela de teste e ignora as cartas dos bots", async () => {
    const { h, flush } = metricsTable(1, "test");
    h.command("c0", "game.start", {});
    h.tick(BOT_SUBMIT_DELAY_MS);

    const batch = await flush();

    expect(batch.private).toEqual([]);
    expect(totalDealt(batch.test)).toBe(handIds(h, "c0").length);
  });

  test("o lote leva apenas o ID da carta e as contagens", async () => {
    const { h, flush } = metricsTable(3);
    h.command("c0", "game.start", {});
    swap(h, respondents(h)[0]!, "free");

    const batch = await flush();

    for (const row of batch.private) expect(Object.keys(row).sort()).toEqual(["cardId", "dealt", "freeSwaps", "paidSwaps"]);
    const text = JSON.stringify(batch);
    expect(text).not.toContain(h.code);
    for (const player of h.view().room.players) {
      expect(text).not.toContain(player.id);
      expect(text).not.toContain(player.nickname);
    }
  });
});

describe("envio das métricas ao banco", () => {
  function silentMetrics(sink: CardMetricsSink, output: string[] = []) {
    let time = 0;
    const logger = createLogger({ level: "debug", write: line => output.push(line) });
    const metrics = createCardMetrics({ sink, logger, now: () => time });
    return { metrics, advance: (ms: number) => { time += ms; } };
  }

  test("envia o lote, zera as contagens e não chama o banco sem dados", async () => {
    const { sink, batches } = recordingSink();
    const { metrics } = silentMetrics(sink);
    await metrics.flush();
    expect(batches).toEqual([]);

    metrics.recorder.recordDealt("private", ["a", "a", "b"]);
    await metrics.flush();
    await metrics.flush();

    expect(batches).toEqual([{ private: [
      { cardId: "a", dealt: 2, freeSwaps: 0, paidSwaps: 0 },
      { cardId: "b", dealt: 1, freeSwaps: 0, paidSwaps: 0 },
    ], test: [] }]);
  });

  test("falha no banco devolve as contagens, avisa e respeita o intervalo antes de tentar de novo", async () => {
    const output: string[] = [];
    const batches: CardMetricsBatch[] = [];
    let failing = true;
    const { metrics, advance } = silentMetrics(batch => {
      if (failing) return Promise.reject(new Error("banco fora do ar"));
      batches.push(structuredClone(batch));
      return Promise.resolve();
    }, output);
    metrics.recorder.recordSwap("private", "a", "free");

    await metrics.flush();
    metrics.recorder.recordSwap("private", "a", "point");
    failing = false;
    await metrics.flush();
    expect(batches).toEqual([]);
    advance(CARD_METRICS_FLUSH_INTERVAL_MS);
    await metrics.flush();

    expect(output.join("\n")).toContain('"event":"card_metrics.flush_failed"');
    expect(output.join("\n")).not.toContain("banco fora do ar");
    expect(batches).toEqual([{ private: [{ cardId: "a", dealt: 0, freeSwaps: 1, paidSwaps: 1 }], test: [] }]);
  });

  test("no desligamento, força o envio mesmo durante o intervalo de espera", async () => {
    const batches: CardMetricsBatch[] = [];
    let failing = true;
    const { metrics } = silentMetrics(batch => {
      if (failing) return Promise.reject(new Error("falha"));
      batches.push(structuredClone(batch));
      return Promise.resolve();
    });
    metrics.recorder.recordDealt("test", ["a"]);
    await metrics.flush();
    failing = false;

    await metrics.flush({ force: true });

    expect(batches).toEqual([{ private: [], test: [{ cardId: "a", dealt: 1, freeSwaps: 0, paidSwaps: 0 }] }]);
  });

  test("envios simultâneos não duplicam o lote", async () => {
    let calls = 0;
    let release = () => {};
    const { metrics } = silentMetrics(() => {
      calls++;
      return new Promise<void>(resolve => { release = resolve; });
    });
    metrics.recorder.recordDealt("private", ["a"]);

    const first = metrics.flush();
    const second = metrics.flush();
    release();
    await Promise.all([first, second]);

    expect(calls).toBe(1);
  });

  test("banco travado não bloqueia os comandos da partida", async () => {
    let calls = 0;
    const metrics = createCardMetrics({
      sink: () => { calls++; return new Promise<void>(() => { /* Nunca responde, como um banco travado. */ }); },
      logger: createLogger({ level: "silent" }),
    });
    const h = table(3, 10, 50, singleCatalog, undefined, "private", null, 15, metrics.recorder);
    h.command("c0", "game.start", {});

    void metrics.flush();
    const player = respondents(h)[0]!;

    expect(errorCode(swap(h, player, "free"))).toBeUndefined();
    h.submitAll();
    expect(h.view().room.phase).toBe("judging");
    expect(calls).toBe(1);
  });

  test("sem DATABASE_URL a coleta fica desligada", async () => {
    const output: string[] = [];
    const logger = createLogger({ level: "info", write: line => output.push(line) });

    const disabled = startCardMetrics(undefined, logger);
    const blank = startCardMetrics("   ", logger);

    expect(disabled.recorder).toBe(NOOP_CARD_METRICS);
    expect(blank.recorder).toBe(NOOP_CARD_METRICS);
    await disabled.stop();
    expect(output.filter(line => line.includes('"event":"card_metrics.disabled"')).length).toBe(2);
  });
});
