import { randomInt } from "node:crypto";
import { DRAW_RANGE, HAND_SIZE, MAX_PLAYERS, PICK_RANGE } from "../../shared/protocol";
import { isBoundedString, isIntegerInRange, isRecord } from "./guards";
import type { Card, Catalog, Deck } from "./types";

export { HAND_SIZE, MAX_PLAYERS };
export const MAX_CARD_ID_LENGTH = 100;
const MAX_CARD_TEXT_LENGTH = 500;
const DEFAULT_PICK = 1;
const DEFAULT_DRAW = 0;
const SWAP_RESERVE_CARDS = 1;

export function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [result[i], result[j]] = [result[j]!, result[i]!];
  }
  return result;
}

export function createCatalog(prompts: unknown, responses: unknown): Catalog {
  const cards = new Map<string, Card>();
  const promptIds = readCards(prompts, "prompt", cards);
  const responseIds = readCards(responses, "response", cards);
  validateCatalogSize(cards, promptIds, responseIds);
  return { cards, promptIds, responseIds };
}

function readCards(input: unknown, kind: Card["kind"], cards: Map<string, Card>): string[] {
  if (!Array.isArray(input)) throw new Error(`Catálogo ${kind} deve ser uma lista.`);
  return input.map((entry: unknown) => {
    const card = parseCard(entry, kind, cards);
    cards.set(card.id, card);
    return card.id;
  });
}

function parseCard(entry: unknown, kind: Card["kind"], existing: ReadonlyMap<string, Card>): Card {
  if (!isRecord(entry)) throw new Error("Carta inválida.");
  const { pick = DEFAULT_PICK, draw = DEFAULT_DRAW } = entry;
  const identity = readCardIdentity(entry.id, entry.text, existing);
  if (kind === "response") return { ...identity, kind };
  return { ...identity, kind, ...readPromptRules(pick, draw) };
}

function readCardIdentity(id: unknown, text: unknown, existing: ReadonlyMap<string, Card>): { id: string; text: string } {
  if (!isBoundedString(id, MAX_CARD_ID_LENGTH) || existing.has(id)) throw new Error("Carta inválida ou ID duplicado.");
  if (!isBoundedString(text, MAX_CARD_TEXT_LENGTH) || !text.trim()) throw new Error("Carta inválida ou ID duplicado.");
  return { id, text: text.trim() };
}

function readPromptRules(pick: unknown, draw: unknown): { pick: number; draw: number } {
  if (!isIntegerInRange(pick, PICK_RANGE) || !isIntegerInRange(draw, DRAW_RANGE)) {
    throw new Error("Pergunta deve exigir de 1 a 3 respostas e comprar de 0 a 2 cartas.");
  }
  return { pick, draw };
}

/**
 * Garante cartas para a mesa cheia, inclusive quando todos compram o máximo de extras,
 * e sobra ao menos uma no monte para quem troca uma carta da mão.
 */
function validateCatalogSize(cards: ReadonlyMap<string, Card>, promptIds: string[], responseIds: string[]): void {
  const maxDraw = Math.max(DEFAULT_DRAW, ...promptIds.map(id => promptDraw(cards.get(id))));
  const minimumResponses = MAX_PLAYERS * HAND_SIZE + (MAX_PLAYERS - 1) * maxDraw + SWAP_RESERVE_CARDS;
  if (!promptIds.length || responseIds.length < minimumResponses) {
    throw new Error(`São necessárias perguntas e pelo menos ${minimumResponses} respostas.`);
  }
}

function promptDraw(card: Card | undefined): number {
  return card?.kind === "prompt" ? card.draw : DEFAULT_DRAW;
}

export async function loadCatalog(): Promise<Catalog> {
  const [prompts, responses] = await Promise.all([
    Bun.file(new URL("../cards/prompts.json", import.meta.url)).json(),
    Bun.file(new URL("../cards/responses.json", import.meta.url)).json(),
  ]);
  return createCatalog(prompts, responses);
}

export function makeDeck(ids: string[]): Deck {
  return { drawPile: shuffled(ids), discardPile: [] };
}

export function draw(deck: Deck): string {
  if (!deck.drawPile.length) {
    deck.drawPile = shuffled(deck.discardPile);
    deck.discardPile = [];
  }
  const card = deck.drawPile.pop();
  if (!card) throw new Error("Baralho esgotado: invariante violada.");
  return card;
}
