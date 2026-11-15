import { randomInt } from "node:crypto";
import type { Card, Catalog, Deck } from "./types";

export const HAND_SIZE = 7;
export const MAX_PLAYERS = 8;

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
  function read(input: unknown, kind: Card["kind"]): string[] {
    if (!Array.isArray(input)) throw new Error(`Catálogo ${kind} deve ser uma lista.`);
    return input.map((entry: unknown) => {
      if (!entry || typeof entry !== "object") throw new Error("Carta inválida.");
      const { id, text, pick = 1, draw = 0 } = entry as Record<string, unknown>;
      if (typeof id !== "string" || !id || id.length > 100 || cards.has(id) ||
          typeof text !== "string" || !text.trim() || text.length > 500) {
        throw new Error("Carta inválida ou ID duplicado.");
      }
      if (kind === "prompt") {
        if (!Number.isInteger(pick) || Number(pick) < 1 || Number(pick) > 3 ||
            !Number.isInteger(draw) || Number(draw) < 0 || Number(draw) > 2) {
          throw new Error("Pergunta deve exigir de 1 a 3 respostas e comprar de 0 a 2 cartas.");
        }
        cards.set(id, { id, text: text.trim(), kind, pick: Number(pick), draw: Number(draw) });
      } else {
        cards.set(id, { id, text: text.trim(), kind });
      }
      return id;
    });
  }
  const promptIds = read(prompts, "prompt");
  const responseIds = read(responses, "response");
  const maxDraw = Math.max(0, ...promptIds.map(id => {
    const card = cards.get(id)!;
    return card.kind === "prompt" ? card.draw : 0;
  }));
  const minimumResponses = MAX_PLAYERS * HAND_SIZE + (MAX_PLAYERS - 1) * maxDraw;
  if (!promptIds.length || responseIds.length < minimumResponses) {
    throw new Error(`São necessárias perguntas e pelo menos ${minimumResponses} respostas.`);
  }
  return { cards, promptIds, responseIds };
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
