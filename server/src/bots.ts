import { randomInt } from "node:crypto";
import { shuffled } from "./cards";
import { isPaused, judgeRound, submitCards } from "./game";
import type { Catalog, GameNotice, GameRoom } from "./types";

export const BOT_SUBMIT_DELAY_MS = 1_500;
export const BOT_JUDGE_DELAY_MS = 2_500;

export function addTestBots(room: GameRoom, now: number): void {
  for (const preferred of ["Bot Sem Filtro", "Bot Mau Conselho"]) {
    let nickname = preferred;
    // O apelido escolhido pela pessoa pode coincidir com um dos nomes dos bots.
    while ([...room.players.values()].some(player => player.nickname.toLocaleLowerCase("pt-BR") === nickname.toLocaleLowerCase("pt-BR"))) {
      nickname += "!";
    }
    const id = crypto.randomUUID();
    room.players.set(id, { id, nickname, score: 0, hand: [], joinedAt: now,
      disconnectedAt: null, sessionToken: null, isBot: true });
    room.playerOrder.push(id);
  }
}

/** Agendamento único por sala, atendido pela manutenção existente, sem timers por bot. */
export function syncBotAction(room: GameRoom, now: number): void {
  const round = room.game.round;
  const phase = room.game.phase;
  if (room.mode !== "test" || !round || isPaused(room) ||
      (phase !== "submitting" && phase !== "judging") ||
      ![...room.players.values()].some(player => !player.isBot && player.disconnectedAt === null)) {
    room.pendingBotAction = null;
    return;
  }
  const player = phase === "submitting"
    ? [...room.players.values()].find(candidate => candidate.isBot &&
      round.respondentPlayerIds.includes(candidate.id) && !round.submissions.has(candidate.id))
    : room.players.get(round.judgePlayerId);
  if (!player?.isBot) {
    room.pendingBotAction = null;
    return;
  }
  const pending = room.pendingBotAction;
  if (pending?.roundId === round.id && pending.phase === phase && pending.playerId === player.id) return;
  room.pendingBotAction = { roundId: round.id, phase, playerId: player.id,
    dueAt: now + (phase === "submitting" ? BOT_SUBMIT_DELAY_MS : BOT_JUDGE_DELAY_MS) };
}

export function runDueBotAction(room: GameRoom, catalog: Catalog, now: number): {
  playerId: string; command: "round.submit" | "round.judge"; notices: GameNotice[];
} | null {
  // Revalidar fase, jogador e rodada antes de agir: agendamentos antigos nunca são executados.
  syncBotAction(room, now);
  const pending = room.pendingBotAction;
  if (!pending || pending.dueAt > now) return null;
  const player = room.players.get(pending.playerId)!;
  const round = room.game.round!;
  const command = pending.phase === "submitting" ? "round.submit" : "round.judge";
  const notices: GameNotice[] = [];
  if (command === "round.submit") {
    submitCards(room, player, round.id, shuffled(player.hand).slice(0, round.pick), now);
  } else {
    const option = round.options[randomInt(round.options.length)]!;
    notices.push(judgeRound(room, player, round.id, option.id, catalog, now));
  }
  room.pendingBotAction = null;
  return { playerId: player.id, command, notices };
}
