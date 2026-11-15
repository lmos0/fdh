import { describe, expect, test } from "bun:test";
import { createLogger } from "../../shared/logging";
import { BOT_JUDGE_DELAY_MS, BOT_SUBMIT_DELAY_MS } from "../src/bots";
import { RESULT_DURATION_MS } from "../src/game";
import { RECONNECT_GRACE_MS } from "../src/rooms";
import { catalog, errorCode, singleCatalog, table } from "./helpers";

function solo(promptId?: string, maxRooms = 50) {
  return table(1, 3, maxRooms, promptId ? { ...catalog, promptIds: [promptId] } : singleCatalog, undefined, "test");
}

function finishFirstRound(h: ReturnType<typeof solo>) {
  h.command("c0", "game.start", {});
  h.tick(BOT_SUBMIT_DELAY_MS);
  h.tick(BOT_SUBMIT_DELAY_MS);
  const round = h.view().room.round!;
  h.command("c0", "round.judge", { roundId: round.id, optionId: round.options[0]!.id });
}

describe("modo de teste individual", () => {
  test("salas normais continuam sem bots e exigem três pessoas", () => {
    const h = table(1);
    expect(h.view().room.mode).toBe("private");
    expect(h.view().room.players.length).toBe(1);
    expect(h.view().room.players.every(player => !player.isBot)).toBe(true);
    expect(errorCode(h.command("c0", "game.start", {}))).toBe("NOT_ENOUGH_PLAYERS");
    expect(h.tick(10_000).deliveries.length).toBe(0);
  });

  test("cria um humano e exatamente dois bots, sem expor credenciais ou mãos", () => {
    const h = solo();
    const state = h.view();
    expect(state.room.mode).toBe("test");
    expect(state.room.phase).toBe("lobby");
    expect(state.room.players.length).toBe(3);
    expect(state.room.players.filter(player => player.isBot).length).toBe(2);
    expect(state.room.players.every(player => player.connected)).toBe(true);
    expect(state.room.hostPlayerId).toBe(state.self.playerId);
    expect(h.credentials.size).toBe(1);
    const text = JSON.stringify(state);
    expect(text).not.toContain(h.credentials.get("c0")!.token);
    for (const player of state.room.players) {
      expect(player).not.toHaveProperty("sessionToken");
      expect(player).not.toHaveProperty("hand");
    }
    expect(state.room).not.toHaveProperty("pendingBotAction");
  });

  test("não aceita convidados ou comandos como outro jogador", () => {
    const h = solo();
    expect(errorCode(h.command("guest", "room.join", { code: h.code, nickname: "Convidado" }))).toBe("TEST_ROOM_PRIVATE");
    expect(errorCode(h.command("guest", "game.start", {}))).toBe("SESSION_REQUIRED");
    expect(errorCode(h.command("guest", "session.resume", { code: h.code, token: "fake-bot-token" }))).toBe("SESSION_INVALID");
    h.command("c0", "game.start", {});
    expect(errorCode(h.command("guest", "room.join", { code: h.code, nickname: "Convidado" }))).toBe("TEST_ROOM_PRIVATE");
    expect(h.view().room.players.length).toBe(3);
  });

  test("humano começa como juiz, bots respondem com atraso sem duplicar ações", () => {
    const h = solo();
    h.command("c0", "game.start", {});
    const roundId = h.view().room.round!.id;
    expect(h.view().room.round!.judgePlayerId).toBe(h.view().self.playerId);
    expect(h.view().room.round!.receivedCount).toBe(0);
    expect(h.view().self.hand.length).toBe(7);
    h.tick(BOT_SUBMIT_DELAY_MS - 1);
    expect(h.view().room.round!.receivedCount).toBe(0);
    h.tick(1);
    expect(h.view().room.round!.receivedCount).toBe(1);
    expect(h.view().room.round!.options.length).toBe(0);
    expect(h.tick(0).deliveries.length).toBe(0);
    h.tick(BOT_SUBMIT_DELAY_MS);
    expect(h.view().room.phase).toBe("judging");
    expect(h.view().room.round!.options.length).toBe(2);
    h.tick(10_000);
    expect(h.view().room.phase).toBe("judging");
    expect(h.view().room.players.every(player => player.score === 0)).toBe(true);
    expect(errorCode(h.command("c0", "round.submit", { roundId, cardIds: [h.view().self.hand[0]!.id] }))).toBe("INVALID_PHASE");
    h.command("c0", "round.judge", { roundId, optionId: h.view().room.round!.options[0]!.id });
    expect(h.view().room.players.reduce((sum, player) => sum + player.score, 0)).toBe(1);
  });

  test("bot juiz aguarda resposta humana e escolhe só depois do prazo", () => {
    const h = solo();
    finishFirstRound(h);
    h.tick(RESULT_DURATION_MS);
    const round = h.view().room.round!;
    expect(round.judgePlayerId).not.toBe(h.view().self.playerId);
    expect(h.view().room.players.find(player => player.id === round.judgePlayerId)!.isBot).toBe(true);
    h.tick(BOT_SUBMIT_DELAY_MS);
    h.tick(10_000);
    expect(h.view().room.phase).toBe("submitting");
    expect(h.view().room.round!.receivedCount).toBe(1);
    h.command("c0", "round.submit", { roundId: round.id, cardIds: [h.view().self.hand[0]!.id] });
    expect(h.view().room.phase).toBe("judging");
    const choices = structuredClone(h.view().room.round!.options);
    h.tick(BOT_JUDGE_DELAY_MS - 1);
    expect(h.view().room.phase).toBe("judging");
    h.tick(1);
    expect(h.view().room.phase).toBe("round_result");
    const result = h.view().room.round!.result!;
    expect(choices.map(choice => choice.id)).toContain(result.winningOptionId);
    expect(result.responseTexts).toEqual(choices.find(choice => choice.id === result.winningOptionId)!.responses);
    expect(h.view().room.players.reduce((sum, player) => sum + player.score, 0)).toBe(2);
    h.tick(0);
    expect(h.view().room.players.reduce((sum, player) => sum + player.score, 0)).toBe(2);
  });

  for (const [id, pick, draw] of [["p77", 2, 0], ["p89", 3, 2]] as const) {
    test(`bots obedecem PICK ${pick} e DRAW ${draw}, com julgamento anônimo`, () => {
      const h = solo(id);
      h.command("c0", "game.start", {});
      expect(h.view().self.hand.length).toBe(7); // Juiz não compra extras.
      h.tick(BOT_SUBMIT_DELAY_MS);
      h.tick(BOT_SUBMIT_DELAY_MS);
      const options = h.view().room.round!.options;
      expect(options.length).toBe(2);
      for (const option of options) {
        expect(Object.keys(option).sort()).toEqual(["id", "responses"]);
        expect(option.responses.length).toBe(pick);
        expect(new Set(option.responses).size).toBe(pick);
      }
      h.command("c0", "round.judge", { roundId: h.view().room.round!.id, optionId: options[0]!.id });
      h.tick(RESULT_DURATION_MS);
      expect(h.view().self.hand.length).toBe(7 + draw);
      const roundId = h.view().room.round!.id;
      expect(errorCode(h.command("c0", "round.submit", { roundId, cardIds: [h.view().self.hand[0]!.id] }))).toBe("INVALID_CARD_COUNT");
      h.command("c0", "round.submit", { roundId, cardIds: h.view().self.hand.slice(0, pick).map(card => card.id) });
      h.tick(BOT_SUBMIT_DELAY_MS);
      h.tick(BOT_JUDGE_DELAY_MS);
      expect(h.view().room.round!.result!.responseTexts.length).toBe(pick);
      expect(h.view().room.players.reduce((sum, player) => sum + player.score, 0)).toBe(2);
    });
  }

  test("desconectar pausa bots e reconectar recupera a sessão sem criar outros bots", () => {
    const h = solo("p89");
    h.command("c0", "game.start", {});
    const before = structuredClone(h.view());
    h.disconnect("c0");
    const idle = h.tick(10_000);
    expect(idle.deliveries.length).toBe(0);
    h.command("new", "session.resume", { code: h.code, token: h.credentials.get("c0")!.token });
    expect(h.view("new").self).toEqual(before.self);
    expect(h.view("new").room.players.map(player => player.id)).toEqual(before.room.players.map(player => player.id));
    expect(h.view("new").room.round!.receivedCount).toBe(0);
    h.tick(BOT_SUBMIT_DELAY_MS - 1);
    expect(h.view("new").room.round!.receivedCount).toBe(0);
    h.tick(1);
    expect(h.view("new").room.round!.receivedCount).toBe(1);
  });

  test("bot não julga enquanto a pessoa está desconectada", () => {
    const h = solo();
    finishFirstRound(h);
    h.tick(RESULT_DURATION_MS);
    h.command("c0", "round.submit", { roundId: h.view().room.round!.id, cardIds: [h.view().self.hand[0]!.id] });
    h.tick(BOT_SUBMIT_DELAY_MS);
    expect(h.view().room.phase).toBe("judging");
    const before = structuredClone(h.view());
    h.disconnect("c0");
    h.tick(10_000);
    h.command("new", "session.resume", { code: h.code, token: h.credentials.get("c0")!.token });
    expect(h.view("new").room.phase).toBe("judging");
    expect(h.view("new").room.players.map(player => player.score)).toEqual(before.room.players.map(player => player.score));
    h.tick(BOT_JUDGE_DELAY_MS);
    expect(h.view("new").room.phase).toBe("round_result");
  });

  test("sair ou expirar a pessoa remove sala e bots e libera o limite de salas", () => {
    for (const expire of [false, true]) {
      const h = solo(undefined, 1);
      h.command("c0", "game.start", {});
      if (expire) { h.disconnect("c0"); h.tick(RECONNECT_GRACE_MS); }
      else h.command("c0", "room.leave", {});
      expect(errorCode(h.command("new", "session.resume", { code: h.code, token: h.credentials.get("c0")!.token }))).toBe("ROOM_NOT_FOUND");
      h.tick(20_000);
      expect(errorCode(h.command("new", "room.create", { nickname: "Novo teste", mode: "test" }))).toBeUndefined();
      expect(h.view("new").room.players.length).toBe(3);
    }
  });

  test("replay da criação é idempotente e nomes dos bots não colidem com o humano", () => {
    const h = solo();
    h.command("c0", "room.leave", {});
    const payload = { nickname: "bot sem filtro", mode: "test" as const };
    h.command("c0", "room.create", payload, "create_test");
    const before = structuredClone(h.view());
    h.command("c0", "room.create", payload, "create_test");
    expect(h.view()).toEqual(before);
    expect(new Set(h.view().room.players.map(player => player.nickname.toLocaleLowerCase("pt-BR"))).size).toBe(3);
  });

  test("partida solo completa alterna juiz e encerra ao atingir a meta", () => {
    const h = solo();
    h.command("c0", "room.configure", { targetScore: 3 });
    h.command("c0", "game.start", {});
    const order = h.view().room.players.map(player => player.id);
    for (let index = 0; index < 7; index++) {
      expect(h.view().room.round!.judgePlayerId).toBe(order[index % 3]);
      const round = h.view().room.round!;
      if (round.judgePlayerId !== h.view().self.playerId) {
        h.command("c0", "round.submit", { roundId: round.id, cardIds: [h.view().self.hand[0]!.id] });
      }
      h.tick(BOT_SUBMIT_DELAY_MS);
      h.tick(BOT_SUBMIT_DELAY_MS);
      if (round.judgePlayerId === h.view().self.playerId) {
        h.command("c0", "round.judge", { roundId: round.id, optionId: h.view().room.round!.options[0]!.id });
      } else h.tick(BOT_JUDGE_DELAY_MS);
      if (h.view().room.phase === "finished") break;
      h.tick(RESULT_DURATION_MS);
    }
    expect(h.view().room.phase).toBe("finished");
    expect(h.view().room.finishReason).toBe("target_reached");
    expect(h.view().room.players.find(player => player.id === h.view().room.winnerPlayerId)!.score).toBe(3);
    h.tick(15 * 60_000);
    expect(errorCode(h.command("new", "room.join", { code: h.code, nickname: "Novo" }))).toBe("ROOM_NOT_FOUND");
  });

  test("logs de bots registram ações sem conteúdo de mãos ou respostas", () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: line => lines.push(line) });
    const h = table(1, 3, 50, singleCatalog, logger, "test");
    finishFirstRound(h);
    const text = lines.join("\n");
    expect(text).toContain('"event":"bot.action_applied"');
    expect(text).toContain('"roomMode":"test"');
    expect(text).not.toContain(h.credentials.get("c0")!.token);
    for (const card of singleCatalog.cards.values()) expect(text).not.toContain(card.text);
    expect(text).not.toContain('"cardIds"');
  });
});
