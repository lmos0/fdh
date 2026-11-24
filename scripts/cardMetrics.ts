import { parseArgs } from "node:util";
import { SQL } from "bun";
import { loadCatalog } from "../server/src/cards";
import { CARD_METRICS_TABLES } from "../server/src/cardMetrics";
import { isRecord } from "../server/src/guards";
import type { Catalog } from "../server/src/types";

// Uso: DATABASE_URL=postgres://… bun run metrics:cards [--sort rate|swaps|paid] [--min-dealt 30] [--limit 20] [--json] [--test]
const DEFAULT_MIN_DEALT = 30;
const DEFAULT_LIMIT = 20;
const TEXT_PREVIEW_LENGTH = 60;
const PERCENT = 100;

interface MetricsRow { cardId: string; dealt: number; freeSwaps: number; paidSwaps: number }
interface RankedCard extends MetricsRow { swaps: number; rate: number; text: string | null }

const SORTS = {
  rate: (a, b) => b.rate - a.rate || b.swaps - a.swaps,
  swaps: (a, b) => b.swaps - a.swaps || b.rate - a.rate,
  paid: (a, b) => b.paidSwaps - a.paidSwaps || b.rate - a.rate,
} as const satisfies Record<string, (a: RankedCard, b: RankedCard) => number>;
type SortKey = keyof typeof SORTS;

function isSortKey(value: string): value is SortKey {
  return Object.hasOwn(SORTS, value);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function readNonNegativeInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) fail(`${name} precisa ser um inteiro maior ou igual a zero.`);
  return parsed;
}

function readOptions() {
  const { values } = parseArgs({ options: {
    sort: { type: "string", default: "rate" },
    "min-dealt": { type: "string" },
    limit: { type: "string" },
    json: { type: "boolean", default: false },
    test: { type: "boolean", default: false },
  } });
  if (!isSortKey(values.sort)) fail(`--sort precisa ser um de: ${Object.keys(SORTS).join(", ")}.`);
  return {
    sort: values.sort,
    minDealt: readNonNegativeInteger(values["min-dealt"], DEFAULT_MIN_DEALT, "--min-dealt"),
    limit: readNonNegativeInteger(values.limit, DEFAULT_LIMIT, "--limit"),
    json: values.json,
    table: CARD_METRICS_TABLES[values.test ? "test" : "private"],
  };
}

function isMetricsRow(value: unknown): value is MetricsRow {
  if (!isRecord(value)) return false;
  return typeof value.cardId === "string"
    && [value.dealt, value.freeSwaps, value.paidSwaps].every(count => typeof count === "number");
}

async function readRows(url: string, table: string): Promise<MetricsRow[]> {
  const sql = new SQL({ url, max: 1 });
  try {
    // A tabela só existe depois do primeiro envio do servidor.
    const [exists] = await sql`SELECT to_regclass(${table}) IS NOT NULL AS found`;
    if (!isRecord(exists) || exists.found !== true) return [];
    const rows: unknown[] = await sql`SELECT card_id AS "cardId", dealt_count::float8 AS dealt,
      free_swap_count::float8 AS "freeSwaps", paid_swap_count::float8 AS "paidSwaps" FROM ${sql(table)}`;
    return rows.filter(isMetricsRow);
  } finally {
    await sql.close();
  }
}

function rank(row: MetricsRow, catalog: Catalog): RankedCard {
  const swaps = row.freeSwaps + row.paidSwaps;
  return { ...row, swaps, rate: row.dealt > 0 ? swaps / row.dealt : 0, text: catalog.cards.get(row.cardId)?.text ?? null };
}

function preview(text: string | null): string {
  if (text === null) return "(fora do catálogo)";
  return text.length > TEXT_PREVIEW_LENGTH ? `${text.slice(0, TEXT_PREVIEW_LENGTH - 1)}…` : text;
}

function printTable(cards: readonly RankedCard[], skipped: number, minDealt: number, table: string): void {
  console.info(`Tabela ${table}: ${cards.length} cartas listadas; ${skipped} com menos de ${minDealt} distribuições foram omitidas.`);
  // Chaves a partir de 1: o console.table usa a chave como coluna de posição.
  console.table(Object.fromEntries(cards.map((card, index) => [index + 1, {
    taxa: `${(card.rate * PERCENT).toFixed(1)}%`,
    trocas: card.swaps,
    pagas: card.paidSwaps,
    distribuída: card.dealt,
    id: card.cardId,
    texto: preview(card.text),
  }])));
}

const options = readOptions();
const url = process.env.DATABASE_URL?.trim();
if (!url) fail("Defina DATABASE_URL para consultar as métricas.");
const [catalog, rows] = await Promise.all([loadCatalog(), readRows(url, options.table)]);
const eligible = rows.map(row => rank(row, catalog)).filter(card => card.dealt >= options.minDealt);
const ranked = eligible.sort(SORTS[options.sort]).slice(0, options.limit);
if (options.json) console.info(JSON.stringify(ranked, null, 2));
else printTable(ranked, rows.length - eligible.length, options.minDealt, options.table);
