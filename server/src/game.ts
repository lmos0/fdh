import { randomInt } from "node:crypto";
import { FREE_SWAPS_PER_GAME, HISTORY_LIMIT, isGameInProgress, MIN_PLAYERS, SWAP_COST_POINTS, type SwapCost } from "../../shared/protocol";
import { fillPlayerPlaceholders, hasPlayerPlaceholder } from "../../shared/prompts";
import { draw, HAND_SIZE, makeDeck, shuffled } from "./cards";
import { requireRule } from "./errors";
import type { Catalog, GameNotice, GameRoom, JudgingOption, Player, Round, GameState } from "./types";

export { HISTORY_LIMIT };
export const RESULT_DURATION_MS = 15_000;
export const MS_PER_SECOND = 1_000;
const NICKNAME_LOCALE = "pt-BR";

type TimedPhase = "submitting" | "judging";

const EXPIRED_ROUND_REASONS = {
  submitting: "O prazo acabou sem respostas. Rodada cancelada, sem pontos; o juiz muda.",
  judging: "O juiz não escolheu dentro do prazo. Rodada cancelada, sem pontos; o juiz muda.",
} as const satisfies Record<TimedPhase, string>;

export function initialGame(): GameState {
  return {
    phase: "lobby", round: null, collectivelyPaused: false, history: [],
    promptDeck: { drawPile: [], discardPile: [] },
    responseDeck: { drawPile: [], discardPile: [] },
    winnerPlayerId: null, finishReason: null, finishedAt: null,
  };
}

function isTimedPhase(phase: GameState["phase"]): phase is TimedPhase {
  return phase === "submitting" || phase === "judging";
}

export function everyoneConnected(room: GameRoom): boolean {
  return [...room.players.values()].every(player => player.disconnectedAt === null);
}

export function hasConnectedHuman(room: GameRoom): boolean {
  return [...room.players.values()].some(player => !player.isBot && player.disconnectedAt === null);
}

export function isNicknameTaken(room: GameRoom, nickname: string): boolean {
  const normalized = nickname.toLocaleLowerCase(NICKNAME_LOCALE);
  return [...room.players.values()].some(player => player.nickname.toLocaleLowerCase(NICKNAME_LOCALE) === normalized);
}

export function requireHost(room: GameRoom, player: Player): void {
  requireRule(room.hostPlayerId === player.id, "NOT_HOST");
}

export function isPaused(room: GameRoom): boolean {
  if (!isGameInProgress(room.game.phase)) return false;
  return room.game.collectivelyPaused || !everyoneConnected(room);
}

export function syncClocks(room: GameRoom, now: number): void {
  const round = room.game.round;
  if (!round) return;
  const paused = isPaused(room);
  if (isTimedPhase(room.game.phase)) syncPhaseClock(round, paused, now);
  if (room.game.phase === "round_result") syncResultClock(round, paused, now);
}

/** Na pausa, o prazo absoluto vira tempo restante; ao retomar, o restante vira prazo de novo. */
function syncPhaseClock(round: Round, paused: boolean, now: number): void {
  if (paused && round.deadlineAt !== null) {
    round.remainingPhaseMs = Math.max(0, round.deadlineAt - now);
    round.deadlineAt = null;
    return;
  }
  if (!paused && round.deadlineAt === null && round.remainingPhaseMs !== null) {
    round.deadlineAt = now + round.remainingPhaseMs;
    round.remainingPhaseMs = null;
  }
}

function syncResultClock(round: Round, paused: boolean, now: number): void {
  if (paused && round.nextRoundAt !== null) {
    round.remainingResultMs = Math.max(0, round.nextRoundAt - now);
    round.nextRoundAt = null;
    return;
  }
  if (!paused && round.nextRoundAt === null && round.remainingResultMs !== null) {
    round.nextRoundAt = now + round.remainingResultMs;
    round.remainingResultMs = null;
  }
}

function secondsToMs(seconds: number | null): number | null {
  return seconds === null ? null : seconds * MS_PER_SECOND;
}

function startPhaseClock(room: GameRoom, round: Round, now: number): void {
  round.deadlineAt = null;
  round.remainingPhaseMs = secondsToMs(room.settings.phaseTimeLimitSeconds);
  syncClocks(room, now);
}

function replenish(room: GameRoom): void {
  for (const player of room.players.values()) {
    // Extras não utilizados numa rodada cancelada não se acumulam na mão.
    if (player.hand.length > HAND_SIZE) {
      room.game.responseDeck.discardPile.push(...player.hand.splice(HAND_SIZE));
    }
    while (player.hand.length < HAND_SIZE) player.hand.push(draw(room.game.responseDeck));
  }
}

function nextJudge(room: GameRoom, previousId: string): string {
  const start = room.playerOrder.indexOf(previousId);
  for (let offset = 1; offset <= room.playerOrder.length; offset++) {
    const id = room.playerOrder[(start + offset) % room.playerOrder.length]!;
    if (room.players.has(id)) return id;
  }
  throw new Error("Não há juiz disponível.");
}

function dealExtraCards(room: GameRoom, judgePlayerId: string, count: number): void {
  for (const player of room.players.values()) {
    if (player.id === judgePlayerId) continue;
    for (let extra = 0; extra < count; extra++) player.hand.push(draw(room.game.responseDeck));
  }
}

function resolvePromptText(room: GameRoom, text: string): string {
  if (!hasPlayerPlaceholder(text)) return text;
  return fillPlayerPlaceholders(text, shuffled([...room.players.values()]).map(player => player.nickname));
}

function beginRound(room: GameRoom, judgePlayerId: string, catalog: Catalog, now: number): void {
  replenish(room);
  const promptCardId = draw(room.game.promptDeck);
  const prompt = catalog.cards.get(promptCardId);
  if (prompt?.kind !== "prompt") throw new Error("Carta de pergunta inválida.");
  dealExtraCards(room, judgePlayerId, prompt.draw);
  const round: Round = {
    id: crypto.randomUUID(), number: (room.game.round?.number ?? 0) + 1, judgePlayerId,
    promptCardId, promptText: resolvePromptText(room, prompt.text), pick: prompt.pick, draw: prompt.draw,
    respondentPlayerIds: [...room.players.keys()].filter(id => id !== judgePlayerId),
    submissions: new Map(), options: [], result: null, cardsSettled: false,
    nextRoundAt: null, remainingResultMs: null,
    deadlineAt: null, remainingPhaseMs: null,
  };
  room.game.round = round;
  room.game.phase = "submitting";
  startPhaseClock(room, round, now);
}

function validateCanStart(room: GameRoom): void {
  requireRule(room.players.size >= MIN_PLAYERS, "NOT_ENOUGH_PLAYERS");
  requireRule(everyoneConnected(room), "PLAYERS_DISCONNECTED");
}

function firstJudge(room: GameRoom): Player {
  const players = [...room.players.values()];
  // No teste, começar como juiz garante que a pessoa veja os dois papéis no rodízio.
  if (room.mode === "test") return players.find(player => !player.isBot)!;
  return players[randomInt(players.length)]!;
}

export function startGame(room: GameRoom, catalog: Catalog, now: number): void {
  requireRule(room.game.phase === "lobby", "INVALID_PHASE");
  validateCanStart(room);
  room.game.promptDeck = makeDeck(catalog.promptIds);
  room.game.responseDeck = makeDeck(catalog.responseIds);
  beginRound(room, firstJudge(room).id, catalog, now);
}

export function restartGame(room: GameRoom, catalog: Catalog, now: number, toLobby = false): void {
  requireRule(room.game.phase === "finished", "INVALID_PHASE");
  if (!toLobby) validateCanStart(room);
  for (const player of room.players.values()) {
    player.score = 0;
    player.hand = [];
    player.freeSwapsUsed = 0;
  }
  room.playerOrder = room.playerOrder.filter(id => room.players.has(id));
  room.pendingBotAction = null;
  room.game = initialGame();
  if (toLobby) return;
  startGame(room, catalog, now);
}

function activeRound(room: GameRoom, roundId: string, phase: TimedPhase): Round {
  requireRule(room.game.round?.id === roundId, "STALE_ROUND");
  requireRule(room.game.phase === phase, "INVALID_PHASE");
  requireRule(!isPaused(room), "GAME_PAUSED");
  return room.game.round;
}

function validateSubmission(round: Round, player: Player, cardIds: string[]): void {
  requireRule(player.id !== round.judgePlayerId, "JUDGE_CANNOT_SUBMIT");
  requireRule(!round.submissions.has(player.id), "ALREADY_SUBMITTED");
  requireRule(round.respondentPlayerIds.includes(player.id), "INVALID_PHASE");
  requireRule(cardIds.length === round.pick, "INVALID_CARD_COUNT");
  requireRule(new Set(cardIds).size === cardIds.length, "DUPLICATE_CARDS");
  requireRule(cardIds.every(id => player.hand.includes(id)), "CARD_NOT_IN_HAND");
}

export function submitCards(room: GameRoom, player: Player, roundId: string, cardIds: string[], now: number): void {
  const round = activeRound(room, roundId, "submitting");
  // Validar a combinação inteira antes de remover qualquer carta; preservar a ordem escolhida.
  validateSubmission(round, player, cardIds);
  player.hand = player.hand.filter(id => !cardIds.includes(id));
  round.submissions.set(player.id, { playerId: player.id, cardIds: [...cardIds] });
  if (round.submissions.size === round.respondentPlayerIds.length) {
    beginJudging(room, round, now);
  }
}

export function swapCostFor(player: Player): SwapCost {
  return player.freeSwapsUsed < FREE_SWAPS_PER_GAME ? "free" : "point";
}

function canAffordSwap(player: Player, cost: SwapCost): boolean {
  return cost === "free" || player.score >= SWAP_COST_POINTS;
}

function validateSwap(round: Round, player: Player, cardId: string, cost: SwapCost): void {
  requireRule(player.id !== round.judgePlayerId, "JUDGE_CANNOT_SWAP");
  requireRule(!round.submissions.has(player.id), "ALREADY_SUBMITTED");
  requireRule(round.respondentPlayerIds.includes(player.id), "INVALID_PHASE");
  requireRule(player.hand.includes(cardId), "CARD_NOT_IN_HAND");
  requireRule(cost === swapCostFor(player), "SWAP_COST_CHANGED");
  requireRule(canAffordSwap(player, cost), "NOT_ENOUGH_POINTS");
}

function chargeSwap(player: Player, cost: SwapCost): void {
  if (cost === "free") {
    player.freeSwapsUsed += 1;
    return;
  }
  player.score -= SWAP_COST_POINTS;
}

export function swapCard(room: GameRoom, player: Player, roundId: string, cardId: string, cost: SwapCost): GameNotice[] {
  const round = activeRound(room, roundId, "submitting");
  validateSwap(round, player, cardId, cost);
  // Comprar antes de descartar: a carta devolvida nunca volta na mesma troca.
  const replacement = draw(room.game.responseDeck);
  player.hand[player.hand.indexOf(cardId)] = replacement;
  room.game.responseDeck.discardPile.push(cardId);
  chargeSwap(player, cost);
  if (cost === "free") return [];
  return [{ type: "card.swapped", payload: { roundId: round.id, playerId: player.id, nickname: player.nickname } }];
}

function beginJudging(room: GameRoom, round: Round, now: number): void {
  round.options = shuffled([...round.submissions.values()])
    .map(submission => ({ ...submission, id: crypto.randomUUID() }));
  room.game.phase = "judging";
  startPhaseClock(room, round, now);
}

function expiredPhase(room: GameRoom, now: number): TimedPhase | null {
  const { phase, round } = room.game;
  if (!isTimedPhase(phase) || !round || round.deadlineAt === null) return null;
  if (isPaused(room) || now < round.deadlineAt) return null;
  return phase;
}

/** Uma única transição por chamada; a fase seguinte recebe seu prazo completo. */
export function expirePhase(room: GameRoom, catalog: Catalog, now: number): GameNotice[] | null {
  const phase = expiredPhase(room, now);
  const round = room.game.round;
  if (!phase || !round) return null;
  if (phase === "submitting" && round.submissions.size > 0) {
    beginJudging(room, round, now);
    return [];
  }
  settleCards(room);
  advanceRound(room, catalog, now);
  return [{ type: "round.cancelled", payload: { roundId: round.id, reason: EXPIRED_ROUND_REASONS[phase] } }];
}

function settleCards(room: GameRoom): void {
  const round = room.game.round;
  if (!round || round.cardsSettled) return;
  room.game.promptDeck.discardPile.push(round.promptCardId);
  for (const submission of round.submissions.values()) {
    room.game.responseDeck.discardPile.push(...submission.cardIds);
  }
  round.cardsSettled = true;
}

export function judgeRound(
  room: GameRoom, player: Player, roundId: string, optionId: string, catalog: Catalog, now: number,
): GameNotice {
  const round = activeRound(room, roundId, "judging");
  requireRule(player.id === round.judgePlayerId, "NOT_JUDGE");
  const option = round.options.find(item => item.id === optionId);
  requireRule(option, "OPTION_NOT_FOUND");
  const winner = room.players.get(option.playerId)!;
  winner.score++;
  const result = recordResult(room, round, winner, option, catalog);
  settleCards(room);
  round.deadlineAt = null;
  round.remainingPhaseMs = null;
  if (winner.score >= room.settings.targetScore) finishByTarget(room, winner, now);
  else showRoundResult(room, round, now);
  return { type: "round.result", payload: result };
}

function recordResult(room: GameRoom, round: Round, winner: Player, option: JudgingOption, catalog: Catalog) {
  const result = {
    roundId: round.id, winnerPlayerId: winner.id, winnerNickname: winner.nickname,
    winningOptionId: option.id, responseTexts: option.cardIds.map(id => catalog.cards.get(id)!.text),
    scores: [...room.players.values()].map(player => ({ playerId: player.id, nickname: player.nickname, score: player.score })),
  };
  round.result = result;
  room.game.history.push({ roundNumber: round.number,
    prompt: { id: round.promptCardId, text: round.promptText, pick: round.pick, draw: round.draw },
    result: structuredClone(result) });
  if (room.game.history.length > HISTORY_LIMIT) room.game.history.shift();
  return result;
}

function finishByTarget(room: GameRoom, winner: Player, now: number): void {
  room.game.phase = "finished";
  room.game.winnerPlayerId = winner.id;
  room.game.finishReason = "target_reached";
  room.game.finishedAt = now;
}

function showRoundResult(room: GameRoom, round: Round, now: number): void {
  room.game.phase = "round_result";
  const intervalMs = secondsToMs(room.settings.resultIntervalSeconds);
  round.nextRoundAt = intervalMs === null ? null : now + intervalMs;
}

export function advanceRound(room: GameRoom, catalog: Catalog, now: number): void {
  beginRound(room, nextJudge(room, room.game.round!.judgePlayerId), catalog, now);
}

// Chamado uma vez para todo o lote de participantes removidos na mesma manutenção.
export function handleDepartures(room: GameRoom, now: number, catalog: Catalog): GameNotice[] {
  if (!isGameInProgress(room.game.phase)) return [];
  const active = isTimedPhase(room.game.phase);
  const notices = active ? cancelActiveRound(room) : [];
  if (room.players.size < MIN_PLAYERS) {
    finishForLackOfPlayers(room, active, now);
  } else if (active) {
    advanceRound(room, catalog, now);
  }
  syncClocks(room, now);
  return notices;
}

function cancelActiveRound(room: GameRoom): GameNotice[] {
  const round = room.game.round;
  if (!round) return [];
  settleCards(room);
  return [{ type: "round.cancelled", payload: {
    roundId: round.id,
    reason: "Um participante saiu. A rodada foi cancelada, sem pontos.",
  } }];
}

function finishForLackOfPlayers(room: GameRoom, roundWasActive: boolean, now: number): void {
  room.game.phase = "finished";
  room.game.finishReason = "not_enough_players";
  room.game.finishedAt = now;
  if (roundWasActive) room.game.round = null;
}
