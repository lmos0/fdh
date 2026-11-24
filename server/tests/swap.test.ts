import { describe, expect, test } from "bun:test";
import { createLogger } from "../../shared/logging";
import { DRAW_RANGE, FREE_SWAPS_PER_GAME, HAND_SIZE, MAX_PLAYERS, SWAP_COST_POINTS, type SwapCost } from "../../shared/protocol";
import { createCatalog } from "../src/cards";
import { RESULT_DURATION_MS } from "../src/game";
import { catalog, errorCode, table } from "./helpers";

type Harness = ReturnType<typeof table>;
const MAX_ROUNDS = 12;

function respondents(h: Harness): string[] {
  const judgeId = h.view().room.round!.judgePlayerId;
  return h.connections.filter(id => h.view(id).self.playerId !== judgeId);
}

function scoreOf(h: Harness, connection: string): number {
  const self = h.view(connection).self.playerId;
  return h.view(connection).room.players.find(player => player.id === self)!.score;
}

function handIds(h: Harness, connection: string): string[] {
  return h.view(connection).self.hand.map(card => card.id);
}

function swap(h: Harness, connection: string, cost: SwapCost, cardId = handIds(h, connection)[0]!) {
  return h.command(connection, "round.swap", { roundId: h.view(connection).room.round!.id, cardId, cost });
}

function freeSwapsOf(h: Harness, connection: string): number {
  return h.view(connection).self.freeSwapsRemaining;
}

function useAllFreeSwaps(h: Harness, connection: string): void {
  while (freeSwapsOf(h, connection) > 0) expect(errorCode(swap(h, connection, "free"))).toBeUndefined();
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

function respondentWithPoint(h: Harness): string | undefined {
  return respondents(h).find(connection => scoreOf(h, connection) >= SWAP_COST_POINTS);
}

function swapEvents(h: Harness, from: number) {
  return h.events.slice(from).filter(delivery => delivery.event.type === "card.swapped");
}

describe("troca de carta da mão", () => {
  test("troca gratuita substitui a carta na mesma posição, sem custo e sem aviso aos outros", () => {
    const h = table(3, 10);
    h.command("c0", "game.start", {});
    const player = respondents(h)[0]!;
    const other = h.connections.find(id => id !== player)!;
    const before = handIds(h, player);
    const discarded = before[2]!;
    const eventsBefore = h.events.length;

    expect(errorCode(swap(h, player, "free", discarded))).toBeUndefined();

    const after = handIds(h, player);
    expect(after.length).toBe(before.length);
    expect(after).not.toContain(discarded);
    expect(after.filter((id, index) => id !== before[index])).toEqual([after[2]!]);
    expect(scoreOf(h, player)).toBe(0);
    expect(freeSwapsOf(h, player)).toBe(FREE_SWAPS_PER_GAME - 1);
    expect(swapEvents(h, eventsBefore)).toEqual([]);
    const otherView = JSON.stringify(h.view(other));
    expect(otherView).not.toContain(`"${after[2]!}"`);
    expect(otherView).not.toContain(`"${discarded}"`);
    expect(JSON.stringify(h.view(other).room)).not.toContain("freeSwap");
    expect(freeSwapsOf(h, other)).toBe(FREE_SWAPS_PER_GAME);
  });

  test("cada troca gratuita reduz o saldo da partida até acabar", () => {
    const h = table(3, 10);
    h.command("c0", "game.start", {});
    const player = respondents(h)[0]!;

    for (let used = 1; used <= FREE_SWAPS_PER_GAME; used++) {
      expect(errorCode(swap(h, player, "free"))).toBeUndefined();
      expect(freeSwapsOf(h, player)).toBe(FREE_SWAPS_PER_GAME - used);
    }

    expect(errorCode(swap(h, player, "free"))).toBe("SWAP_COST_CHANGED");
    expect(scoreOf(h, player)).toBe(0);
  });

  test("as trocas gratuitas valem por partida, não por rodada", () => {
    const h = table(3, 10);
    h.command("c0", "game.start", {});
    const player = respondents(h)[0]!;
    useAllFreeSwaps(h, player);
    playRound(h);
    playUntil(h, () => respondents(h).includes(player));

    expect(errorCode(swap(h, player, "free"))).toBe("SWAP_COST_CHANGED");
    expect(freeSwapsOf(h, player)).toBe(0);
  });

  test("troca paga desconta um ponto e avisa todos sem revelar as cartas", () => {
    const output: string[] = [];
    const logger = createLogger({ level: "debug", write: line => output.push(line) });
    const h = table(3, 20, 50, undefined, logger);
    h.command("c0", "game.start", {});
    playUntil(h, () => respondentWithPoint(h) !== undefined);
    const player = respondentWithPoint(h)!;
    useAllFreeSwaps(h, player);
    const scoreBefore = scoreOf(h, player);
    const discarded = handIds(h, player)[0]!;
    const eventsBefore = h.events.length;

    expect(errorCode(swap(h, player, "point", discarded))).toBeUndefined();

    const replacement = handIds(h, player)[0]!;
    expect(scoreOf(h, player)).toBe(scoreBefore - SWAP_COST_POINTS);
    expect(handIds(h, player)).not.toContain(discarded);
    const events = swapEvents(h, eventsBefore);
    expect(events.map(delivery => delivery.connectionId).sort()).toEqual([...h.connections].sort());
    const self = h.view(player).self.playerId;
    const nickname = h.view(player).room.players.find(entry => entry.id === self)!.nickname;
    for (const { event } of events) {
      expect(event.type === "card.swapped" && event.payload)
        .toEqual({ roundId: h.view().room.round!.id, playerId: self, nickname });
      expect(JSON.stringify(event)).not.toContain(`"${discarded}"`);
      expect(JSON.stringify(event)).not.toContain(`"${replacement}"`);
    }
    const logs = output.join("\n");
    expect(logs).toContain('"swapCost":"point"');
    expect(logs).not.toContain(`"${discarded}"`);
    expect(logs).not.toContain(nickname);
  });

  test("recusa troca paga de quem não tem pontos", () => {
    const h = table(3, 10);
    h.command("c0", "game.start", {});
    const player = respondents(h)[0]!;
    useAllFreeSwaps(h, player);
    const before = handIds(h, player);

    expect(errorCode(swap(h, player, "point"))).toBe("NOT_ENOUGH_POINTS");
    expect(handIds(h, player)).toEqual(before);
    expect(scoreOf(h, player)).toBe(0);
  });

  test("recusa custo diferente do confirmado na tela", () => {
    const h = table(3, 10);
    h.command("c0", "game.start", {});
    const player = respondents(h)[0]!;
    const before = handIds(h, player);

    expect(errorCode(swap(h, player, "point"))).toBe("SWAP_COST_CHANGED");
    expect(handIds(h, player)).toEqual(before);
    expect(freeSwapsOf(h, player)).toBe(FREE_SWAPS_PER_GAME);
  });

  test("juiz não troca carta", () => {
    const h = table(3, 10);
    h.command("c0", "game.start", {});
    const judge = h.judgeConnection();
    const before = handIds(h, judge);

    expect(errorCode(swap(h, judge, "free"))).toBe("JUDGE_CANNOT_SWAP");
    expect(handIds(h, judge)).toEqual(before);
    expect(freeSwapsOf(h, judge)).toBe(FREE_SWAPS_PER_GAME);
  });

  test("não troca depois de enviar a resposta", () => {
    const h = table(4, 10);
    h.command("c0", "game.start", {});
    const [player] = respondents(h);
    const roundId = h.view().room.round!.id;
    h.command(player!, "round.submit", { roundId, cardIds: [handIds(h, player!)[0]!] });

    expect(errorCode(swap(h, player!, "free"))).toBe("ALREADY_SUBMITTED");
    expect(freeSwapsOf(h, player!)).toBe(FREE_SWAPS_PER_GAME);
  });

  test("não troca carta que não está na própria mão", () => {
    const h = table(3, 10);
    h.command("c0", "game.start", {});
    const [player, other] = respondents(h);

    expect(errorCode(swap(h, player!, "free", handIds(h, other!)[0]!))).toBe("CARD_NOT_IN_HAND");
    expect(freeSwapsOf(h, player!)).toBe(FREE_SWAPS_PER_GAME);
  });

  test("não troca fora da fase de respostas", () => {
    const h = table(3, 10);
    h.command("c0", "game.start", {});
    const player = respondents(h)[0]!;
    h.submitAll();

    expect(errorCode(swap(h, player, "free"))).toBe("INVALID_PHASE");
  });

  test("não troca em rodada antiga", () => {
    const h = table(3, 10);
    h.command("c0", "game.start", {});
    const player = respondents(h)[0]!;
    const cardId = handIds(h, player)[0]!;

    expect(errorCode(h.command(player, "round.swap", { roundId: "rodada-antiga", cardId, cost: "free" }))).toBe("STALE_ROUND");
  });

  test("não troca durante a pausa", () => {
    const h = table(3, 10);
    h.command("c0", "game.start", {});
    const player = respondents(h)[0]!;
    h.command("c0", "game.pause", { roundId: h.view().room.round!.id, paused: true });

    expect(errorCode(swap(h, player, "free"))).toBe("GAME_PAUSED");
    expect(freeSwapsOf(h, player)).toBe(FREE_SWAPS_PER_GAME);
  });

  test("reiniciar a partida devolve as trocas gratuitas", () => {
    const h = table(3, 3);
    h.command("c0", "game.start", {});
    const player = respondents(h)[0]!;
    useAllFreeSwaps(h, player);
    playUntil(h, () => h.view().room.phase === "finished");

    h.command("c0", "game.restart", {});

    for (const connection of h.connections) expect(freeSwapsOf(h, connection)).toBe(FREE_SWAPS_PER_GAME);
  });

  test("compra carta mesmo com o catálogo mínimo e todas as mãos cheias", () => {
    const minimumSize = MAX_PLAYERS * HAND_SIZE + (MAX_PLAYERS - 1) * DRAW_RANGE.max + 1;
    const minimum = createCatalog([{ id: "multi", text: "Faça uma combinação.", pick: 3, draw: 2 }],
      catalog.responseIds.slice(0, minimumSize).map(id => ({ id, text: catalog.cards.get(id)!.text })));
    const h = table(MAX_PLAYERS, 20, 50, minimum);
    h.command("c0", "game.start", {});
    const player = respondents(h)[0]!;
    const discarded = handIds(h, player)[0]!;

    expect(errorCode(swap(h, player, "free", discarded))).toBeUndefined();

    const hands = h.connections.flatMap(id => handIds(h, id));
    expect(hands).not.toContain(discarded);
    expect(new Set(hands).size).toBe(hands.length);
  });
});
