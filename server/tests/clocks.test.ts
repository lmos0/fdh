import { describe, expect, test } from "bun:test";
import { parseMessage } from "../src/protocol";
import { HISTORY_LIMIT, RESULT_DURATION_MS } from "../src/game";
import { createRoomService, RECONNECT_GRACE_MS } from "../src/rooms";
import { BOT_SUBMIT_DELAY_MS } from "../src/bots";
import { catalog, errorCode, singleCatalog, table } from "./helpers";

function timed(count = 4, limit: number | null = 30, interval: number | null = 15) {
  const h = table(count, 20, 50, singleCatalog, undefined, "private", limit, interval);
  h.command("c0", "game.start", {});
  return h;
}
type Table = ReturnType<typeof timed>;
function submitOne(h: Table, connection = h.connections.find(id => id !== h.judgeConnection())!) {
  const view = h.view(connection);
  return h.command(connection, "round.submit", { roundId: view.room.round!.id,
    cardIds: view.self.hand.slice(0, view.room.round!.prompt.pick).map(card => card.id) });
}
function choose(h: Table, requestId?: string) {
  const round = h.view().room.round!;
  return h.command(h.judgeConnection(), "round.judge", { roundId: round.id, optionId: round.options[0]!.id }, requestId);
}
function pause(h: Table, paused: boolean, connection = "c0", requestId?: string) {
  return h.command(connection, "game.pause", { roundId: h.view().room.round!.id, paused }, requestId);
}

describe("prazos autoritativos e pausa coletiva", () => {
  test("salas novas têm 60 segundos por fase e 15 segundos de resultado", () => {
    const service = createRoomService(singleCatalog);
    const output = service.execute("new", { type: "room.create", requestId: "create", payload: { nickname: "Pessoa" } });
    const event = output.deliveries.find(item => item.event.type === "state.snapshot")!.event;
    if (event.type !== "state.snapshot") throw new Error("Snapshot esperado");
    expect(event.payload.room.settings).toEqual({ targetScore: 5, phaseTimeLimitSeconds: 60, resultIntervalSeconds: 15 });
  });

  test("configurações e pausas recusam tipos inválidos, campos extras e ausência de rodada", () => {
    for (const key of ["phaseTimeLimitSeconds", "resultIntervalSeconds"]) {
      for (const value of [0, -1, 3.5, 600, "60", false, {}, []]) {
        expect(() => parseMessage(JSON.stringify({ type: "room.configure", requestId: "bad", payload: { targetScore: 5, [key]: value } }))).toThrow();
      }
    }
    for (const payload of [{ paused: true }, { roundId: "r", paused: "true" }, { roundId: "r", paused: true, deadlineAt: 0 }]) {
      expect(() => parseMessage(JSON.stringify({ type: "game.pause", requestId: "bad", payload }))).toThrow();
    }
    const h = table();
    expect(errorCode(h.command("c1", "room.configure", { targetScore: 5, phaseTimeLimitSeconds: 30 }))).toBe("NOT_HOST");
    expect(errorCode(h.command("c0", "game.pause", { roundId: "r", paused: true }))).toBe("INVALID_PHASE");
  });

  test("respostas parciais viram opções anônimas no limite exato e juiz recebe novo prazo completo", () => {
    const h = timed();
    const initial = h.view().room.round!;
    submitOne(h);
    h.tick(29_999);
    expect(h.view().room.phase).toBe("submitting");
    expect(h.view().room.round!.options).toEqual([]);
    h.tick(1);
    const round = h.view().room.round!;
    expect(h.view().room.phase).toBe("judging");
    expect(round.id).toBe(initial.id);
    expect(round.receivedCount).toBe(1);
    expect(round.options).toHaveLength(1);
    expect(Object.keys(round.options[0]!).sort()).toEqual(["id", "responses"]);
    expect(round.deadlineAt).toBe(h.view().serverNow + 30_000);
    expect(errorCode(choose(h))).toBeUndefined();
    expect(h.view().room.players.reduce((sum, p) => sum + p.score, 0)).toBe(1);
  });

  test("todos respondendo antes do prazo iniciam imediatamente o relógio do juiz", () => {
    const h = timed();
    h.tick(12_000);
    h.submitAll();
    expect(h.view().room.phase).toBe("judging");
    expect(h.view().room.round!.deadlineAt).toBe(h.view().serverNow + 30_000);
  });

  test("ninguém responde: cancela uma vez sem pontos, repõe mãos e gira juiz", () => {
    const h = timed();
    const old = h.view().room.round!;
    const output = h.tick(30_000);
    const round = h.view().room.round!;
    expect(round.number).toBe(old.number + 1);
    expect(round.judgePlayerId).not.toBe(old.judgePlayerId);
    expect(output.deliveries.filter(item => item.event.type === "round.cancelled")).toHaveLength(4);
    expect(h.view().room.history).toEqual([]);
    h.tick(0);
    expect(h.view().room.round!.id).toBe(round.id);
    for (const id of h.connections) expect(h.view(id).self.hand).toHaveLength(7);
    expect(h.view().room.players.every(p => p.score === 0)).toBe(true);
  });

  test("juiz ausente cancela sem prêmio automático nem histórico", () => {
    const h = timed();
    h.submitAll();
    const round = h.view().room.round!;
    const judge = h.judgeConnection();
    h.elapse(30_000); // Sem manutenção: o próprio comando atrasado precisa expirar a fase.
    expect(errorCode(h.command(judge, "round.judge", { roundId: round.id, optionId: round.options[0]!.id }))).toBe("STALE_ROUND");
    expect(h.view().room.round!.judgePlayerId).not.toBe(round.judgePlayerId);
    expect(h.view().room.history).toEqual([]);
    expect(h.view().room.players.every(p => p.score === 0)).toBe(true);
  });

  test("envio atrasado não entra nas respostas parciais mesmo antes da manutenção", () => {
    const h = timed();
    const respondents = h.connections.filter(id => id !== h.judgeConnection());
    submitOne(h, respondents[0]);
    const missing = respondents[1]!;
    const hand = h.view(missing).self.hand;
    h.elapse(30_000);
    expect(errorCode(submitOne(h, missing))).toBe("INVALID_PHASE");
    expect(h.view(missing).self.hand).toEqual(hand);
    expect(h.view().room.round!.options).toHaveLength(1);
  });

  test("sem limite não expira envio nem julgamento", () => {
    const h = timed(4, null);
    h.tick(86_400_000);
    expect(h.view().room.phase).toBe("submitting");
    expect(h.view().room.round!.deadlineAt).toBeNull();
    h.submitAll();
    h.tick(86_400_000);
    expect(h.view().room.phase).toBe("judging");
    expect(errorCode(choose(h))).toBeUndefined();
  });

  test("qualquer membro pausa/retoma e cliques repetidos não reiniciam nem gastam tempo", () => {
    const h = timed();
    h.tick(7_000);
    expect(errorCode(pause(h, true, "c1", "pause"))).toBeUndefined();
    expect(h.view().room.round!.remainingPhaseMs).toBe(23_000);
    const duplicate = pause(h, true, "c1", "pause");
    expect(errorCode(duplicate)).toBeUndefined();
    h.tick(120_000);
    expect(errorCode(submitOne(h))).toBe("GAME_PAUSED");
    pause(h, true, "c2");
    expect(h.view().room.round!.remainingPhaseMs).toBe(23_000);
    pause(h, false, "c3");
    h.tick(22_999);
    expect(h.view().room.round!.number).toBe(1);
    h.tick(1);
    expect(h.view().room.round!.number).toBe(2);
  });

  for (const manualFirst of [false, true]) {
    test(`pausas sobrepostas: ${manualFirst ? "reconexão" : "retomada coletiva"} não remove a outra pausa`, () => {
      const h = timed();
      h.tick(5_000);
      if (manualFirst) pause(h, true);
      h.disconnect("c1");
      if (!manualFirst) pause(h, true);
      h.tick(10_000);
      if (!manualFirst) pause(h, false);
      else h.command("new", "session.resume", { code: h.code, token: h.credentials.get("c1")!.token });
      expect(h.view().room.paused).toBe(true);
      expect(h.view().room.round!.remainingPhaseMs).toBe(25_000);
      h.tick(10_000);
      if (manualFirst) pause(h, false);
      else h.command("new", "session.resume", { code: h.code, token: h.credentials.get("c1")!.token });
      expect(h.view().room.paused).toBe(false);
      expect(h.view().room.round!.deadlineAt).toBe(h.view().serverNow + 25_000);
    });
  }

  test("desconexão no limite não salva uma fase já expirada", () => {
    const h = timed();
    h.elapse(30_000);
    h.disconnect("c1");
    expect(h.view().room.round!.number).toBe(2);
    expect(h.view().room.round!.remainingPhaseMs).toBe(30_000);
  });

  test("expiração de reconexão durante pausa coletiva cancela mas não retoma", () => {
    const h = timed();
    pause(h, true);
    h.disconnect("c1");
    h.tick(RECONNECT_GRACE_MS);
    expect(h.view().room.round!.number).toBe(2);
    expect(h.view().room.paused).toBe(true);
    expect(h.view().room.collectivelyPaused).toBe(true);
    expect(h.view().room.round!.remainingPhaseMs).toBe(30_000);
  });

  test("comando de pausa velho não afeta nova rodada e configuração fica travada após início", () => {
    const h = timed();
    const old = h.view().room.round!.id;
    h.elapse(30_000);
    expect(errorCode(h.command("c0", "game.pause", { roundId: old, paused: true }))).toBe("STALE_ROUND");
    expect(h.view().room.paused).toBe(false);
    expect(errorCode(h.command("c0", "room.configure", { targetScore: 5, phaseTimeLimitSeconds: null }))).toBe("INVALID_PHASE");
  });

  test("bots respeitam pausa coletiva e continuam após retomada", () => {
    const h = table(1, 20, 50, singleCatalog, undefined, "test", 30);
    h.command("c0", "game.start", {});
    pause(h, true);
    h.tick(90_000);
    expect(h.view().room.round!.receivedCount).toBe(0);
    pause(h, false);
    h.tick(BOT_SUBMIT_DELAY_MS);
    h.tick(BOT_SUBMIT_DELAY_MS);
    expect(h.view().room.phase).toBe("judging");
    pause(h, true);
    h.tick(90_000);
    expect(h.view().room.phase).toBe("judging");
    pause(h, false);
    choose(h);
    expect(h.view().room.history).toHaveLength(1);
  });

  test("cancelamentos PICK 3/DRAW 2 não acumulam extras nem duplicam cartas", () => {
    const h = table(4, 20, 50, { ...catalog, promptIds: ["p89"] }, undefined, "private", 30);
    h.command("c0", "game.start", {});
    for (let round = 0; round < 80; round++) {
      if (round % 2) { submitOne(h); h.tick(30_000); }
      h.tick(30_000);
      const held = h.connections.flatMap(id => h.view(id).self.hand.map(card => card.id));
      expect(new Set(held).size).toBe(held.length);
      for (const id of h.connections) {
        expect(h.view(id).self.hand.length).toBe(id === h.judgeConnection() ? 7 : 9);
      }
    }
  });
});

describe("intervalos, avanço e histórico", () => {
  test("intervalo padrão é maior e pode ser configurado", () => {
    expect(RESULT_DURATION_MS).toBe(15_000);
    const h = timed(4, 30, 30);
    h.submitAll(); choose(h);
    expect(h.view().room.round!.nextRoundAt).toBe(h.view().serverNow + 30_000);
    const id = h.view().room.round!.id;
    h.tick(29_999);
    expect(h.view().room.round!.id).toBe(id);
    h.tick(1);
    expect(h.view().room.round!.id).not.toBe(id);
  });

  test("avanço manual não expira; só anfitrião avança uma vez", () => {
    const h = timed(4, 30, null);
    h.submitAll(); choose(h, "winner");
    const round = h.view().room.round!;
    expect(round.nextRoundAt).toBeNull();
    h.tick(90_000);
    expect(h.view().room.phase).toBe("round_result");
    expect(errorCode(h.command("c1", "round.advance", { roundId: round.id }))).toBe("NOT_HOST");
    pause(h, true);
    expect(errorCode(h.command("c0", "round.advance", { roundId: round.id }))).toBe("GAME_PAUSED");
    pause(h, false);
    expect(errorCode(h.command("c0", "round.advance", { roundId: round.id }, "advance"))).toBeUndefined();
    h.command("c0", "round.advance", { roundId: round.id }, "advance");
    expect(h.view().room.round!.number).toBe(2);
    expect(errorCode(h.command("c0", "round.advance", { roundId: round.id }))).toBe("STALE_ROUND");
    expect(h.view().room.players.reduce((sum, p) => sum + p.score, 0)).toBe(1);
  });

  test("avanço automático e manual no mesmo limite não pulam duas rodadas", () => {
    const h = timed();
    h.submitAll(); choose(h);
    const id = h.view().room.round!.id;
    h.elapse(15_000);
    expect(errorCode(h.command("c0", "round.advance", { roundId: id }))).toBe("STALE_ROUND");
    expect(h.view().room.round!.number).toBe(2);
  });

  test("novo anfitrião pode avançar resultado manual após saída do anterior", () => {
    const h = timed(4, 30, null);
    h.submitAll(); choose(h);
    const roundId = h.view().room.round!.id;
    h.command("c0", "room.leave", {});
    expect(h.view("c1").room.hostPlayerId).toBe(h.view("c1").self.playerId);
    expect(errorCode(h.command("c1", "round.advance", { roundId }))).toBeUndefined();
    expect(h.view("c1").room.round!.number).toBe(2);
    expect(h.view("c1").room.history).toHaveLength(1);
  });

  test("pausas congelam intervalo e não duplicam pontos ou entrada no histórico", () => {
    const h = timed();
    h.submitAll();
    const judge = h.judgeConnection();
    const round = h.view().room.round!;
    choose(h, "winner");
    h.tick(5_000); pause(h, true); h.disconnect("c1");
    expect(h.view().room.round!.remainingResultMs).toBe(10_000);
    h.tick(20_000);
    h.command("new", "session.resume", { code: h.code, token: h.credentials.get("c1")!.token });
    expect(h.view().room.paused).toBe(true);
    pause(h, false);
    const judgeConnection = judge === "c1" ? "new" : judge;
    h.command(judgeConnection, "round.judge", { roundId: round.id, optionId: round.options[0]!.id }, "winner");
    expect(h.view().room.history).toHaveLength(1);
    h.tick(9_999); expect(h.view().room.round!.id).toBe(round.id);
    h.tick(1); expect(h.view().room.round!.number).toBe(2);
    expect(h.view().room.history).toHaveLength(1);
  });

  test("histórico guarda pergunta, ordem e autor; sobrevive a reconexão sem vazar opções perdedoras", () => {
    const h = table(4, 20, 50, { ...catalog, promptIds: ["p89"] }, undefined, "private", 30, null);
    h.command("c0", "game.start", {}); h.submitAll();
    const round = h.view().room.round!;
    expect(h.view().room.history).toEqual([]);
    choose(h);
    const history = structuredClone(h.view().room.history);
    expect(history[0]!.prompt).toEqual(round.prompt);
    expect(history[0]!.result.responseTexts).toEqual(round.options[0]!.responses);
    expect(history[0]!.result.winnerNickname).toBe(h.view().room.round!.result!.winnerNickname);
    expect(history[0]!.result.winnerPlayerId).toBe(h.view().room.round!.result!.winnerPlayerId);
    h.disconnect("c1");
    h.command("new", "session.resume", { code: h.code, token: h.credentials.get("c1")!.token });
    expect(h.view("new").room.history).toEqual(history);
    // Alterar uma projeção nunca modifica o histórico autoritativo.
    h.view().room.history[0]!.result.responseTexts[0] = "alterado";
    h.command("c0", "round.advance", { roundId: round.id });
    expect(h.view().room.history).toEqual(history);
    expect(h.view().room.round!.options).toEqual([]);
  });

  test("histórico tem limite em memória e não duplica entradas ao repetir julgamento", () => {
    const h = timed(4, null, null);
    for (let index = 0; index < HISTORY_LIMIT + 3; index++) {
      h.submitAll();
      const round = h.view().room.round!;
      // Distribuir pontos deterministicamente para não encerrar antes de testar o limite.
      const target = h.connections.filter(id => id !== h.judgeConnection()).sort((a, b) =>
        h.view(a).room.players.find(p => p.id === h.view(a).self.playerId)!.score -
        h.view(b).room.players.find(p => p.id === h.view(b).self.playerId)!.score)[0]!;
      const texts = h.view(target).self.submittedResponses.map(card => card.text);
      const optionId = round.options.find(option => JSON.stringify(option.responses) === JSON.stringify(texts))!.id;
      const payload = { roundId: round.id, optionId };
      h.command(h.judgeConnection(), "round.judge", payload, `winner_${index}`);
      h.command(h.judgeConnection(), "round.judge", payload, `winner_${index}`);
      h.command("c0", "round.advance", { roundId: round.id });
    }
    expect(h.view().room.history).toHaveLength(HISTORY_LIMIT);
    expect(h.view().room.history[0]!.roundNumber).toBe(4);
    expect(new Set(h.view().room.history.map(entry => entry.result.roundId)).size).toBe(HISTORY_LIMIT);
  });
});
