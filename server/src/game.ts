import { randomInt } from "node:crypto";
import { draw, HAND_SIZE, makeDeck, shuffled } from "./cards";
import { requireRule } from "./errors";
import type { Catalog, GameNotice, GameRoom, GameState, Player, Round } from "./types";

export const RESULT_DURATION_MS = 15_000;
export const HISTORY_LIMIT = 30;

export function initialGame(): GameState {
  return {
    phase: "lobby", round: null, collectivelyPaused: false, history: [],
    promptDeck: { drawPile: [], discardPile: [] },
    responseDeck: { drawPile: [], discardPile: [] },
    winnerPlayerId: null, finishReason: null, finishedAt: null,
  };
}

export function isPaused(room: GameRoom): boolean {
  return room.game.phase !== "lobby" && room.game.phase !== "finished" &&
    (room.game.collectivelyPaused || [...room.players.values()].some(player => player.disconnectedAt !== null));
}

export function syncClocks(room: GameRoom, now: number): void {
  const round = room.game.round;
  if (!round) return;
  if (room.game.phase === "submitting" || room.game.phase === "judging") {
    if (isPaused(room) && round.deadlineAt !== null) {
      round.remainingPhaseMs = Math.max(0, round.deadlineAt - now);
      round.deadlineAt = null;
    } else if (!isPaused(room) && round.deadlineAt === null && round.remainingPhaseMs !== null) {
      round.deadlineAt = now + round.remainingPhaseMs;
      round.remainingPhaseMs = null;
    }
  }
  if (room.game.phase !== "round_result") return;
  if (isPaused(room) && round.nextRoundAt !== null) {
    round.remainingResultMs = Math.max(0, round.nextRoundAt - now);
    round.nextRoundAt = null;
  } else if (!isPaused(room) && round.nextRoundAt === null && round.remainingResultMs !== null) {
    round.nextRoundAt = now + round.remainingResultMs;
    round.remainingResultMs = null;
  }
}

function startPhaseClock(room: GameRoom, now: number): void {
  const round = room.game.round!;
  round.deadlineAt = null;
  round.remainingPhaseMs = room.settings.phaseTimeLimitSeconds === null ? null : room.settings.phaseTimeLimitSeconds * 1_000;
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

function beginRound(room: GameRoom, judgePlayerId: string, catalog: Catalog, now: number): void {
  replenish(room);
  const promptCardId = draw(room.game.promptDeck);
  const prompt = catalog.cards.get(promptCardId)!;
  if (prompt.kind !== "prompt") throw new Error("Carta de pergunta inválida.");
  for (const player of room.players.values()) {
    if (player.id !== judgePlayerId) {
      for (let extra = 0; extra < prompt.draw; extra++) player.hand.push(draw(room.game.responseDeck));
    }
  }
  const number = (room.game.round?.number ?? 0) + 1;
  room.game.round = {
    id: crypto.randomUUID(), number, judgePlayerId,
    promptCardId, pick: prompt.pick, draw: prompt.draw,
    respondentPlayerIds: [...room.players.keys()].filter(id => id !== judgePlayerId),
    submissions: new Map(), options: [], result: null, cardsSettled: false,
    nextRoundAt: null, remainingResultMs: null,
    deadlineAt: null, remainingPhaseMs: null,
  };
  room.game.phase = "submitting";
  startPhaseClock(room, now);
}

export function startGame(room: GameRoom, catalog: Catalog, now: number): void {
  requireRule(room.game.phase === "lobby", "INVALID_PHASE");
  requireRule(room.players.size >= 3, "NOT_ENOUGH_PLAYERS");
  requireRule([...room.players.values()].every(p => p.disconnectedAt === null), "PLAYERS_DISCONNECTED");
  room.game.promptDeck = makeDeck(catalog.promptIds);
  room.game.responseDeck = makeDeck(catalog.responseIds);
  const players = [...room.players.values()];
  // No teste, começar como juiz garante que a pessoa veja os dois papéis no rodízio.
  const judge = room.mode === "test" ? players.find(player => !player.isBot)! : players[randomInt(players.length)]!;
  beginRound(room, judge.id, catalog, now);
}

function activeRound(room: GameRoom, roundId: string, phase: "submitting" | "judging"): Round {
  requireRule(room.game.round?.id === roundId, "STALE_ROUND");
  requireRule(room.game.phase === phase, "INVALID_PHASE");
  requireRule(!isPaused(room), "GAME_PAUSED");
  return room.game.round;
}

export function submitCards(room: GameRoom, player: Player, roundId: string, cardIds: string[], now: number): void {
  const round = activeRound(room, roundId, "submitting");
  requireRule(player.id !== round.judgePlayerId, "JUDGE_CANNOT_SUBMIT");
  requireRule(!round.submissions.has(player.id), "ALREADY_SUBMITTED");
  requireRule(round.respondentPlayerIds.includes(player.id), "INVALID_PHASE");
  requireRule(cardIds.length === round.pick, "INVALID_CARD_COUNT");
  requireRule(new Set(cardIds).size === cardIds.length, "DUPLICATE_CARDS");
  requireRule(cardIds.every(id => player.hand.includes(id)), "CARD_NOT_IN_HAND");
  // Validar a combinação inteira antes de remover qualquer carta; preservar a ordem escolhida.
  player.hand = player.hand.filter(id => !cardIds.includes(id));
  round.submissions.set(player.id, { playerId: player.id, cardIds: [...cardIds] });
  if (round.submissions.size === round.respondentPlayerIds.length) {
    beginJudging(room, now);
  }
}

function beginJudging(room: GameRoom, now: number): void {
  const round = room.game.round!;
  round.options = shuffled([...round.submissions.values()])
    .map(submission => ({ ...submission, id: crypto.randomUUID() }));
  room.game.phase = "judging";
  startPhaseClock(room, now);
}

/** Uma única transição por chamada; a fase seguinte recebe seu prazo completo. */
export function expirePhase(room: GameRoom, catalog: Catalog, now: number): GameNotice[] | null {
  const round = room.game.round;
  if (isPaused(room) || !round || round.deadlineAt === null || now < round.deadlineAt ||
      (room.game.phase !== "submitting" && room.game.phase !== "judging")) return null;
  if (room.game.phase === "submitting" && round.submissions.size > 0) {
    beginJudging(room, now);
    return [];
  }
  const reason = room.game.phase === "submitting"
    ? "O prazo acabou sem respostas. Rodada cancelada, sem pontos; o juiz muda."
    : "O juiz não escolheu dentro do prazo. Rodada cancelada, sem pontos; o juiz muda.";
  settleCards(room);
  advanceRound(room, catalog, now);
  return [{ type: "round.cancelled", payload: { roundId: round.id, reason } }];
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
  round.result = {
    roundId: round.id, winnerPlayerId: winner.id, winnerNickname: winner.nickname,
    winningOptionId: option.id, responseTexts: option.cardIds.map(id => catalog.cards.get(id)!.text),
    scores: [...room.players.values()].map(p => ({ playerId: p.id, nickname: p.nickname, score: p.score })),
  };
  const prompt = catalog.cards.get(round.promptCardId)!;
  room.game.history.push({ roundNumber: round.number,
    prompt: { id: prompt.id, text: prompt.text, pick: round.pick, draw: round.draw }, result: structuredClone(round.result) });
  if (room.game.history.length > HISTORY_LIMIT) room.game.history.shift();
  settleCards(room);
  round.deadlineAt = null;
  round.remainingPhaseMs = null;
  if (winner.score >= room.settings.targetScore) {
    room.game.phase = "finished";
    room.game.winnerPlayerId = winner.id;
    room.game.finishReason = "target_reached";
    room.game.finishedAt = now;
  } else {
    room.game.phase = "round_result";
    round.nextRoundAt = room.settings.resultIntervalSeconds === null ? null : now + room.settings.resultIntervalSeconds * 1_000;
  }
  return { type: "round.result", payload: round.result };
}

export function advanceRound(room: GameRoom, catalog: Catalog, now: number): void {
  beginRound(room, nextJudge(room, room.game.round!.judgePlayerId), catalog, now);
}

// Chamado uma vez para todo o lote de participantes removidos na mesma manutenção.
export function handleDepartures(room: GameRoom, now: number, catalog: Catalog): GameNotice[] {
  if (room.game.phase === "lobby" || room.game.phase === "finished") return [];
  const notices: GameNotice[] = [];
  const active = room.game.phase === "submitting" || room.game.phase === "judging";
  if (active && room.game.round) {
    notices.push({ type: "round.cancelled", payload: {
      roundId: room.game.round.id,
      reason: "Um participante saiu. A rodada foi cancelada, sem pontos.",
    } });
    settleCards(room);
  }
  if (room.players.size < 3) {
    room.game.phase = "finished";
    room.game.finishReason = "not_enough_players";
    room.game.finishedAt = now;
    if (active) room.game.round = null;
  } else if (active) {
    advanceRound(room, catalog, now);
  }
  syncClocks(room, now);
  return notices;
}
