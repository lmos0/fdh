import { randomInt } from "node:crypto";
import { shuffled } from "./cards";
import { hasConnectedHuman, isNicknameTaken, isPaused, judgeRound, submitCards } from "./game";
import type { Catalog, GameNotice, GameRoom, Player, Round } from "./types";

export const BOT_SUBMIT_DELAY_MS = 1_500;
export const BOT_JUDGE_DELAY_MS = 2_500;
const BOT_NICKNAMES = ["Bot Sem Filtro", "Bot Mau Conselho"] as const;

type BotPhase = "submitting" | "judging";
type BotCommand = "round.submit" | "round.judge";

const BOT_DELAYS_MS = { submitting: BOT_SUBMIT_DELAY_MS, judging: BOT_JUDGE_DELAY_MS } as const satisfies Record<BotPhase, number>;
const BOT_COMMANDS = { submitting: "round.submit", judging: "round.judge" } as const satisfies Record<BotPhase, BotCommand>;

export function addTestBots(room: GameRoom, now: number): void {
  for (const preferred of BOT_NICKNAMES) {
    let nickname: string = preferred;
    // O apelido escolhido pela pessoa pode coincidir com um dos nomes dos bots.
    while (isNicknameTaken(room, nickname)) nickname += "!";
    const id = crypto.randomUUID();
    room.players.set(id, { id, nickname, score: 0, hand: [], joinedAt: now,
      disconnectedAt: null, sessionToken: null, isBot: true });
    room.playerOrder.push(id);
  }
}

function botPhase(room: GameRoom): BotPhase | null {
  const phase = room.game.phase;
  return phase === "submitting" || phase === "judging" ? phase : null;
}

function canBotsAct(room: GameRoom): boolean {
  return room.mode === "test" && !isPaused(room) && hasConnectedHuman(room);
}

function nextBotActor(room: GameRoom, round: Round, phase: BotPhase): Player | undefined {
  const actor = phase === "submitting"
    ? [...room.players.values()].find(candidate => candidate.isBot &&
      round.respondentPlayerIds.includes(candidate.id) && !round.submissions.has(candidate.id))
    : room.players.get(round.judgePlayerId);
  return actor?.isBot ? actor : undefined;
}

/** Agendamento único por sala, atendido pela manutenção existente, sem timers por bot. */
export function syncBotAction(room: GameRoom, now: number): void {
  const round = room.game.round;
  const phase = botPhase(room);
  const player = round && phase && canBotsAct(room) ? nextBotActor(room, round, phase) : undefined;
  if (!round || !phase || !player) {
    room.pendingBotAction = null;
    return;
  }
  const pending = room.pendingBotAction;
  if (pending?.roundId === round.id && pending.phase === phase && pending.playerId === player.id) return;
  room.pendingBotAction = { roundId: round.id, phase, playerId: player.id, dueAt: now + BOT_DELAYS_MS[phase] };
}

export function runDueBotAction(room: GameRoom, catalog: Catalog, now: number): {
  playerId: string; command: BotCommand; notices: GameNotice[];
} | null {
  // Revalidar fase, jogador e rodada antes de agir: agendamentos antigos nunca são executados.
  syncBotAction(room, now);
  const pending = room.pendingBotAction;
  if (!pending || pending.dueAt > now) return null;
  const player = room.players.get(pending.playerId)!;
  const round = room.game.round!;
  const notices = pending.phase === "submitting"
    ? submitRandomCards(room, player, round, now)
    : judgeRandomOption(room, player, round, catalog, now);
  room.pendingBotAction = null;
  return { playerId: player.id, command: BOT_COMMANDS[pending.phase], notices };
}

function submitRandomCards(room: GameRoom, player: Player, round: Round, now: number): GameNotice[] {
  submitCards(room, player, round.id, shuffled(player.hand).slice(0, round.pick), now);
  return [];
}

function judgeRandomOption(room: GameRoom, player: Player, round: Round, catalog: Catalog, now: number): GameNotice[] {
  const option = round.options[randomInt(round.options.length)]!;
  return [judgeRound(room, player, round.id, option.id, catalog, now)];
}
