import { describe, expect, test } from "bun:test";
import { RESULT_DURATION_MS } from "../src/game";
import { RECONNECT_GRACE_MS } from "../src/rooms";
import { errorCode, table } from "./helpers";

describe("salas e autorização", () => {
  test("dois navegadores compartilham o lobby, mas não iniciam partida", () => {
    const h = table(2);
    expect(h.view("c0").room.players).toEqual(h.view("c1").room.players);
    expect(h.view().room.players.length).toBe(2);
    expect(errorCode(h.command("c0", "game.start", {}))).toBe("NOT_ENOUGH_PLAYERS");
  });

  test("somente anfitrião configura e inicia", () => {
    const h = table();
    expect(errorCode(h.command("c1", "room.configure", { targetScore: 7 }))).toBe("NOT_HOST");
    expect(errorCode(h.command("c1", "game.start", {}))).toBe("NOT_HOST");
    h.command("c0", "room.configure", { targetScore: 7 });
    expect(h.view("c2").room.settings.targetScore).toBe(7);
  });

  test("impede apelidos iguais, lotação e entrada depois do início", () => {
    const h = table(8);
    expect(errorCode(h.command("extra", "room.join", { code: h.code, nickname: "Extra" }))).toBe("ROOM_FULL");
    const other = table();
    expect(errorCode(other.command("extra", "room.join", { code: other.code, nickname: "pessoa 0" }))).toBe("NICKNAME_TAKEN");
    other.command("c0", "game.start", {});
    expect(errorCode(other.command("extra", "room.join", { code: other.code, nickname: "Extra" }))).toBe("GAME_ALREADY_STARTED");
  });

  test("limita salas e impede um socket de entrar duas vezes", () => {
    const h = table(1, 3, 1);
    expect(errorCode(h.command("extra", "room.create", { nickname: "Extra" }))).toBe("SERVER_FULL");
    expect(errorCode(h.command("c0", "room.create", { nickname: "Duplicado" }))).toBe("ALREADY_IN_ROOM");
  });

  test("transfere anfitrião e remove sala sem participantes", () => {
    const h = table(2);
    const nextHost = h.view("c1").self.playerId;
    h.command("c0", "room.leave", {});
    expect(h.view("c1").room.hostPlayerId).toBe(nextHost);
    h.command("c1", "room.leave", {});
    expect(errorCode(h.command("extra", "room.join", { code: h.code, nickname: "Extra" }))).toBe("ROOM_NOT_FOUND");
  });
});

describe("partida e privacidade", () => {
  test("distribui sete cartas únicas a oito pessoas e não transmite mãos alheias", () => {
    const h = table(8);
    h.command("c0", "game.start", {});
    const allIds = h.connections.flatMap(id => h.view(id).self.hand.map(card => card.id));
    expect(allIds.length).toBe(56);
    expect(new Set(allIds).size).toBe(56);
    const serialized = JSON.stringify(h.view());
    for (const id of h.view("c1").self.hand.map(card => card.id)) expect(serialized).not.toContain(`"${id}"`);
    for (const credential of h.credentials.values()) expect(serialized).not.toContain(credential.token);
    expect(h.view().room.players[0]).not.toHaveProperty("hand");
    expect(h.view().room.players[0]).not.toHaveProperty("sessionToken");
  });

  test("bloqueia juiz, cartas alheias e respostas duplicadas", () => {
    const h = table();
    h.command("c0", "game.start", {});
    const judge = h.judgeConnection();
    const respondent = h.connections.find(id => id !== judge)!;
    const roundId = h.view().room.round!.id;
    expect(errorCode(h.command(judge, "round.submit", { roundId, cardIds: [h.view(judge).self.hand[0]!.id] }))).toBe("JUDGE_CANNOT_SUBMIT");
    expect(errorCode(h.command(respondent, "round.submit", { roundId, cardIds: [h.view(judge).self.hand[0]!.id] }))).toBe("CARD_NOT_IN_HAND");
    const cardId = h.view(respondent).self.hand[0]!.id;
    h.command(respondent, "round.submit", { roundId, cardIds: [cardId] });
    expect(errorCode(h.command(respondent, "round.submit", { roundId, cardIds: [cardId] }))).toBe("ALREADY_SUBMITTED");
    expect(h.view().room.round!.receivedCount).toBe(1);
    expect(h.view().room.round!.options).toEqual([]);
  });

  test("julgamento expõe opções sem autoria ou ID original da carta", () => {
    const h = table();
    h.command("c0", "game.start", {});
    const originalIds = h.connections.flatMap(id => h.view(id).self.hand.map(card => card.id));
    h.submitAll();
    expect(h.view().room.phase).toBe("judging");
    const options = h.view().room.round!.options;
    expect(options.length).toBe(2);
    for (const option of options) {
      expect(Object.keys(option).sort()).toEqual(["id", "responses"]);
      expect(originalIds).not.toContain(option.id);
    }
    const nonJudge = h.connections.find(id => id !== h.judgeConnection())!;
    expect(errorCode(h.command(nonJudge, "round.judge", {
      roundId: h.view().room.round!.id, optionId: options[0]!.id,
    }))).toBe("NOT_JUDGE");
  });

  test("pontua só uma vez, repõe mãos, troca juiz e rejeita rodada antiga", () => {
    const h = table();
    h.command("c0", "game.start", {});
    const previousJudge = h.view().room.round!.judgePlayerId;
    const oldRoundId = h.view().room.round!.id;
    h.submitAll();
    const payload = { roundId: oldRoundId, optionId: h.view().room.round!.options[0]!.id };
    const judge = h.judgeConnection();
    h.command(judge, "round.judge", payload);
    expect(h.view().room.players.reduce((sum, p) => sum + p.score, 0)).toBe(1);
    expect(errorCode(h.command(judge, "round.judge", payload))).toBe("INVALID_PHASE");
    expect(h.view().room.players.reduce((sum, p) => sum + p.score, 0)).toBe(1);
    h.tick(RESULT_DURATION_MS);
    expect(h.view().room.phase).toBe("submitting");
    const players = h.view().room.players;
    const nextId = players[(players.findIndex(p => p.id === previousJudge) + 1) % players.length]!.id;
    expect(h.view().room.round!.judgePlayerId).toBe(nextId);
    for (const id of h.connections) expect(h.view(id).self.hand.length).toBe(7);
    expect(errorCode(h.command(judge, "round.judge", payload))).toBe("STALE_ROUND");
  });

  test("repetir requestId não repete resposta, ponto nem notificação", () => {
    const h = table();
    h.command("c0", "game.start", {});
    const judge = h.judgeConnection();
    const respondent = h.connections.find(id => id !== judge)!;
    const payload = { roundId: h.view().room.round!.id, cardIds: [h.view(respondent).self.hand[0]!.id] };
    h.command(respondent, "round.submit", payload, "same_submit");
    expect(errorCode(h.command(respondent, "round.submit", payload, "same_submit"))).toBeUndefined();
    expect(h.view().room.round!.receivedCount).toBe(1);
    expect(errorCode(h.command(respondent, "round.submit", { ...payload, cardIds: ["different"] }, "same_submit"))).toBe("REQUEST_ID_REUSED");
    const other = h.connections.find(id => id !== judge && id !== respondent)!;
    h.command(other, "round.submit", { roundId: payload.roundId, cardIds: [h.view(other).self.hand[0]!.id] });
    const verdict = { roundId: payload.roundId, optionId: h.view().room.round!.options[0]!.id };
    h.command(judge, "round.judge", verdict, "same_judge");
    const retry = h.command(judge, "round.judge", verdict, "same_judge");
    expect(retry.deliveries.some(d => d.event.type === "round.result")).toBe(false);
    expect(h.view().room.players.reduce((sum, p) => sum + p.score, 0)).toBe(1);
  });

  test("recicla cartas por dezenas de rodadas sem duplicar cartas nas mãos", () => {
    const h = table(8, 20);
    h.command("c0", "game.start", {});
    for (let round = 0; round < 40; round++) {
      h.submitAll();
      // Escolher o menor placar mantém o teste longo determinístico, apesar do embaralhamento.
      const lowest = h.connections.map(id => h.view(id))
        .filter(snapshot => snapshot.self.submitted)
        .sort((a, b) => {
          const score = (snapshot: typeof a) => snapshot.room.players.find(p => p.id === snapshot.self.playerId)!.score;
          return score(a) - score(b);
        })[0]!;
      const option = h.view().room.round!.options.find(item => item.responses[0] === lowest.self.submittedResponses[0]!.text)!;
      h.command(h.judgeConnection(), "round.judge", {
        roundId: h.view().room.round!.id, optionId: option.id,
      });
      expect(h.view().room.phase).toBe("round_result");
      h.tick(RESULT_DURATION_MS);
      const hands = h.connections.flatMap(id => h.view(id).self.hand.map(card => card.id));
      expect(hands.length).toBe(56);
      expect(new Set(hands).size).toBe(56);
    }
  });

  test("termina partida ao atingir a meta e mantém último resultado", () => {
    const h = table();
    h.command("c0", "game.start", {});
    for (let round = 0; round < 10 && h.view().room.phase !== "finished"; round++) {
      h.submitAll();
      h.command(h.judgeConnection(), "round.judge", {
        roundId: h.view().room.round!.id, optionId: h.view().room.round!.options[0]!.id,
      });
      h.tick(RESULT_DURATION_MS);
    }
    expect(h.view().room.phase).toBe("finished");
    expect(h.view().room.finishReason).toBe("target_reached");
    const winner = h.view().room.players.find(p => p.id === h.view().room.winnerPlayerId)!;
    expect(winner.score).toBe(3);
    expect(h.view().room.round!.result!.winnerPlayerId).toBe(winner.id);
    h.tick(15 * 60_000);
    expect(h.events.some(d => d.event.type === "room.closed")).toBe(true);
    expect(errorCode(h.command("extra", "room.join", { code: h.code, nickname: "Extra" }))).toBe("ROOM_NOT_FOUND");
  });
});

describe("desconexão e reconexão", () => {
  test("recupera identidade e mão sem duplicar participante", () => {
    const h = table();
    h.command("c0", "game.start", {});
    const before = structuredClone(h.view("c1"));
    h.disconnect("c1");
    expect(h.view().room.paused).toBe(true);
    h.tick(10_000);
    const credential = h.credentials.get("c1")!;
    h.command("new", "session.resume", { code: h.code, token: credential.token });
    expect(h.view("new").self).toEqual(before.self);
    expect(h.view().room.players.length).toBe(3);
    expect(h.view().room.paused).toBe(false);
  });

  test("recupera resposta já enviada e bloqueia ações durante pausa", () => {
    const h = table();
    h.command("c0", "game.start", {});
    const respondent = h.connections.find(id => id !== h.judgeConnection())!;
    const { id: roundId } = h.view().room.round!;
    h.command(respondent, "round.submit", { roundId, cardIds: [h.view(respondent).self.hand[0]!.id] });
    const before = structuredClone(h.view(respondent).self);
    h.disconnect(respondent);
    const other = h.connections.find(id => id !== respondent && id !== h.judgeConnection())!;
    expect(errorCode(h.command(other, "round.submit", { roundId, cardIds: [h.view(other).self.hand[0]!.id] }))).toBe("GAME_PAUSED");
    h.command("new", "session.resume", { code: h.code, token: h.credentials.get(respondent)!.token });
    expect(h.view("new").self).toEqual(before);
    expect(h.view().room.round!.receivedCount).toBe(1);
  });

  test("nova conexão substitui anterior sem desconexão fantasma", () => {
    const h = table();
    const output = h.command("new", "session.resume", { code: h.code, token: h.credentials.get("c1")!.token });
    expect(output.closeConnections).toEqual(["c1"]);
    expect(errorCode(h.command("c1", "room.leave", {}))).toBe("CONNECTION_REPLACED");
    h.disconnect("c1");
    expect(h.view().room.players.every(p => p.connected)).toBe(true);
    h.command("new", "room.leave", {});
    expect(h.view().room.players.length).toBe(2);
  });

  test("token errado ou de outra sala não recupera sessão", () => {
    const h = table();
    expect(errorCode(h.command("new", "session.resume", { code: h.code, token: "wrong" }))).toBe("SESSION_INVALID");
    h.command("extra", "room.create", { nickname: "Outra pessoa" });
    const otherCode = h.view("extra").room.code;
    expect(errorCode(h.command("new", "session.resume", { code: otherCode, token: h.credentials.get("c1")!.token }))).toBe("SESSION_INVALID");
  });

  test("expiração de participante cancela rodada e preserva rodízio", () => {
    const h = table(4);
    h.command("c0", "game.start", {});
    const judge = h.judgeConnection();
    const oldRound = h.view().room.round!;
    const observer = h.connections.find(id => id !== judge)!;
    h.disconnect(judge);
    h.tick(RECONNECT_GRACE_MS);
    expect(h.view(observer).room.phase).toBe("submitting");
    expect(h.view(observer).room.players.length).toBe(3);
    expect(h.view(observer).room.round!.id).not.toBe(oldRound.id);
    expect(h.view(observer).room.round!.judgePlayerId).not.toBe(oldRound.judgePlayerId);
    expect(h.events.some(d => d.event.type === "round.cancelled")).toBe(true);
    expect(h.view(observer).room.players.every(p => p.score === 0)).toBe(true);
  });

  test("saída com três jogadores encerra partida sem vencedor", () => {
    const h = table();
    h.command("c0", "game.start", {});
    h.command("c1", "room.leave", {});
    expect(h.view().room.phase).toBe("finished");
    expect(h.view().room.finishReason).toBe("not_enough_players");
    expect(h.view().room.winnerPlayerId).toBeNull();
  });

  test("expira participantes em lote, cancelando a rodada uma única vez", () => {
    const h = table(5);
    h.command("c0", "game.start", {});
    h.disconnect("c1");
    h.disconnect("c2");
    const output = h.tick(RECONNECT_GRACE_MS);
    const cancellations = output.deliveries.filter(delivery => delivery.event.type === "round.cancelled");
    expect(cancellations.length).toBe(3);
    expect(new Set(cancellations.map(delivery => delivery.connectionId)).size).toBe(3);
    expect(h.view().room.round!.number).toBe(2);
    expect(h.view().room.players.length).toBe(3);
    expect(h.view().room.paused).toBe(false);
  });

  test("pausa congela o intervalo do resultado sem desfazer ponto", () => {
    const h = table(4);
    h.command("c0", "game.start", {});
    h.submitAll();
    h.command(h.judgeConnection(), "round.judge", {
      roundId: h.view().room.round!.id, optionId: h.view().room.round!.options[0]!.id,
    });
    const roundId = h.view().room.round!.id;
    h.tick(2_000);
    h.disconnect("c1");
    expect(h.view().room.round!.nextRoundAt).toBeNull();
    h.tick(10_000);
    h.command("new", "session.resume", { code: h.code, token: h.credentials.get("c1")!.token });
    h.tick(RESULT_DURATION_MS - 2_001);
    expect(h.view().room.round!.id).toBe(roundId);
    h.tick(1);
    expect(h.view().room.round!.id).not.toBe(roundId);
    expect(h.view().room.players.reduce((sum, p) => sum + p.score, 0)).toBe(1);
  });

  test("saída durante resultado mantém pontos", () => {
    const h = table(4);
    h.command("c0", "game.start", {});
    h.submitAll();
    const judge = h.judgeConnection();
    h.command(judge, "round.judge", {
      roundId: h.view().room.round!.id, optionId: h.view().room.round!.options[0]!.id,
    });
    const winnerId = h.view().room.round!.result!.winnerPlayerId;
    const leaving = h.connections.find(id => id !== "c0" && h.view(id).self.playerId !== winnerId)!;
    h.command(leaving, "room.leave", {});
    h.tick(RESULT_DURATION_MS);
    expect(h.view().room.players.find(p => p.id === winnerId)!.score).toBe(1);
    expect(h.view().room.phase).toBe("submitting");
  });

  test("remove todas as sessões abandonadas e não recupera sala após reinício", () => {
    const h = table();
    for (const id of h.connections) h.disconnect(id);
    h.tick(RECONNECT_GRACE_MS);
    expect(errorCode(h.command("extra", "room.join", { code: h.code, nickname: "Extra" }))).toBe("ROOM_NOT_FOUND");
    const fresh = table(1);
    expect(errorCode(fresh.command("new", "session.resume", { code: h.code, token: h.credentials.get("c0")!.token }))).toBe("ROOM_NOT_FOUND");
  });
});
