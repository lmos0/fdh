import { describe, expect, test } from "bun:test";
import { createGameSoundTracker } from "../../client/src/audio/state";
import { BOT_JUDGE_DELAY_MS, BOT_SUBMIT_DELAY_MS } from "../src/bots";
import { HAND_SIZE } from "../src/cards";
import { parseMessage } from "../src/protocol";
import { errorCode, singleCatalog, table } from "./helpers";

function finishMatch(h: ReturnType<typeof table>) {
  h.command("c0", "game.start", {});
  for (let round = 0; round < 15 && h.view().room.phase !== "finished"; round++) {
    h.submitAll();
    const judge = h.judgeConnection();
    const current = h.view(judge).room.round!;
    h.command(judge, "round.judge", { roundId: current.id, optionId: current.options[0]!.id });
    if (h.view().room.phase === "round_result") h.tick(15_000);
  }
  expect(h.view().room.phase).toBe("finished");
}

describe("reiniciar partida na mesma sala", () => {
  test("anfitrião reinicia imediatamente na mesma sala, zera estado e cancela expiração de fim de jogo", () => {
    const h = table(3, 3);
    const originalCode = h.code;
    finishMatch(h);
    const finishedRoundId = h.view().room.round!.id;
    expect(h.view().room.history.length).toBeGreaterThanOrEqual(3);
    expect(h.view().room.winnerPlayerId).not.toBeNull();

    const tracker = createGameSoundTracker();
    tracker.observe(h.view("c0"));

    const out = h.command("c0", "game.restart", {});
    expect(errorCode(out)).toBeUndefined();

    const snap = h.view("c0");
    expect(snap.room.code).toBe(originalCode);
    expect(snap.room.phase).toBe("submitting");
    expect(snap.room.winnerPlayerId).toBeNull();
    expect(snap.room.finishReason).toBeNull();
    expect(snap.room.history).toEqual([]);
    expect(snap.room.round!.number).toBe(1);
    expect(snap.room.round!.id).not.toBe(finishedRoundId);
    expect(snap.room.players.every(player => player.score === 0)).toBe(true);
    for (const connectionId of h.connections) {
      expect(h.view(connectionId).self.hand.length).toBe(HAND_SIZE);
    }

    const sound = tracker.observe(snap);
    expect(sound).toBe(snap.room.round!.judgePlayerId === snap.self.playerId ? "judge" : "round");

    // A sala não expira após 15 minutos porque finishedAt foi limpo.
    const afterWait = h.tick(16 * 60_000);
    expect(afterWait.deliveries.some(d => d.event.type === "room.closed")).toBe(false);
    expect(h.view("c0").room.phase).toBe("submitting");

    // A nova partida funciona até um novo vencedor.
    h.submitAll();
    const judge = h.judgeConnection();
    const round = h.view(judge).room.round!;
    h.command(judge, "round.judge", { roundId: round.id, optionId: round.options[0]!.id });
    expect(h.view("c0").room.history.length).toBe(1);
  });

  test("voltar à sala de espera permite reconfigurar, receber novo jogador com o mesmo código e começar de novo", () => {
    const h = table(3, 3);
    const originalCode = h.code;
    finishMatch(h);

    const tracker = createGameSoundTracker();
    tracker.observe(h.view("c0"));

    // Jogador 2 sai após o fim: restam 2 pessoas (< 3).
    h.command("c2", "room.leave", {});
    expect(h.view("c0").room.players.length).toBe(2);
    // Reinício imediato recusa sem mutar o estado final.
    expect(errorCode(h.command("c0", "game.restart", {}))).toBe("NOT_ENOUGH_PLAYERS");
    expect(h.view("c0").room.phase).toBe("finished");
    expect(h.view("c0").room.winnerPlayerId).not.toBeNull();

    // Voltar à sala de espera funciona mesmo com menos de 3 participantes.
    expect(errorCode(h.command("c0", "game.restart", { toLobby: true }))).toBeUndefined();
    const lobby = h.view("c0");
    expect(lobby.room.code).toBe(originalCode);
    expect(lobby.room.phase).toBe("lobby");
    expect(lobby.room.round).toBeNull();
    expect(lobby.room.history).toEqual([]);
    expect(lobby.room.winnerPlayerId).toBeNull();
    expect(lobby.room.finishReason).toBeNull();
    expect(lobby.room.players.every(player => player.score === 0)).toBe(true);
    expect(lobby.self.hand).toEqual([]);
    expect(tracker.observe(lobby)).toBeNull();

    // Anfitrião reconfigura, nova pessoa entra com o mesmo código e a partida recomeça.
    expect(errorCode(h.command("c0", "room.configure", { targetScore: 7 }))).toBeUndefined();
    expect(errorCode(h.command("c3", "room.join", { code: originalCode, nickname: "Pessoa 3" }))).toBeUndefined();
    expect(errorCode(h.command("c0", "game.start", {}))).toBeUndefined();
    expect(h.view("c0").room.phase).toBe("submitting");
    expect(h.view("c0").room.settings.targetScore).toBe(7);
    expect(h.view("c3").self.hand.length).toBe(HAND_SIZE);
  });

  test("também permite voltar à sala de espera após encerramento por falta de jogadores", () => {
    const h = table(3, 3);
    h.command("c0", "game.start", {});
    h.command("c2", "room.leave", {});
    expect(h.view("c0").room.phase).toBe("finished");
    expect(h.view("c0").room.finishReason).toBe("not_enough_players");

    expect(errorCode(h.command("c0", "game.restart", { toLobby: true }))).toBeUndefined();
    expect(h.view("c0").room.phase).toBe("lobby");
    expect(h.view("c0").room.code).toBe(h.code);
  });

  test("valida permissões, fase, desconexão e payload", () => {
    const h = table(3, 3);
    expect(errorCode(h.command("c0", "game.restart", {}))).toBe("INVALID_PHASE");
    h.command("c0", "game.start", {});
    expect(errorCode(h.command("c0", "game.restart", {}))).toBe("INVALID_PHASE");

    // Termina a partida.
    for (let round = 0; round < 15 && h.view().room.phase !== "finished"; round++) {
      h.submitAll();
      const judge = h.judgeConnection();
      const current = h.view(judge).room.round!;
      h.command(judge, "round.judge", { roundId: current.id, optionId: current.options[0]!.id });
      if (h.view().room.phase === "round_result") h.tick(15_000);
    }

    // Não anfitrião não pode reiniciar.
    expect(errorCode(h.command("c1", "game.restart", {}))).toBe("NOT_HOST");
    expect(errorCode(h.command("c1", "game.restart", { toLobby: true }))).toBe("NOT_HOST");

    // Desconexão bloqueia reinício imediato sem corromper placar, mas permite voltar ao lobby.
    const scoresBefore = h.view("c0").room.players.map(player => player.score);
    h.disconnect("c1");
    expect(errorCode(h.command("c0", "game.restart", {}))).toBe("PLAYERS_DISCONNECTED");
    expect(h.view("c0").room.phase).toBe("finished");
    expect(h.view("c0").room.players.map(player => player.score)).toEqual(scoresBefore);

    // Payload inválido é rejeitado pelo protocolo.
    expect(() => parseMessage(JSON.stringify({ type: "game.restart", requestId: "r1", payload: { toLobby: "yes" } }))).toThrow();
    expect(() => parseMessage(JSON.stringify({ type: "game.restart", requestId: "r2", payload: { extra: true } }))).toThrow();
  });

  test("modo de teste com bots reinicia na mesma sala e agenda ações dos bots", () => {
    const h = table(1, 3, 50, singleCatalog, undefined, "test");
    h.command("c0", "game.start", {});
    for (let round = 0; round < 20 && h.view("c0").room.phase !== "finished"; round++) {
      const snap = h.view("c0");
      if (snap.room.phase === "submitting") {
        if (snap.room.round!.judgePlayerId !== snap.self.playerId && !snap.self.submitted) {
          h.command("c0", "round.submit", { roundId: snap.room.round!.id, cardIds: [snap.self.hand[0]!.id] });
        }
        h.tick(BOT_SUBMIT_DELAY_MS);
        h.tick(BOT_SUBMIT_DELAY_MS);
      }
      const judging = h.view("c0");
      if (judging.room.phase === "judging") {
        if (judging.room.round!.judgePlayerId === judging.self.playerId) {
          h.command("c0", "round.judge", { roundId: judging.room.round!.id, optionId: judging.room.round!.options[0]!.id });
        } else {
          h.tick(BOT_JUDGE_DELAY_MS);
        }
      }
      if (h.view("c0").room.phase === "round_result") h.tick(15_000);
    }
    expect(h.view("c0").room.phase).toBe("finished");

    expect(errorCode(h.command("c0", "game.restart", {}))).toBeUndefined();
    const restarted = h.view("c0");
    expect(restarted.room.code).toBe(h.code);
    expect(restarted.room.phase).toBe("submitting");
    expect(restarted.room.round!.judgePlayerId).toBe(restarted.self.playerId);
    expect(restarted.room.players.every(player => player.score === 0)).toBe(true);

    // Bots respondem automaticamente na nova partida.
    h.tick(BOT_SUBMIT_DELAY_MS);
    h.tick(BOT_SUBMIT_DELAY_MS);
    expect(h.view("c0").room.phase).toBe("judging");
    expect(h.view("c0").room.round!.options.length).toBe(2);
  });
});
