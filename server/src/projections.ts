import type { CardView, Snapshot } from "../../shared/protocol";
import { isPaused } from "./game";
import type { Catalog, GameRoom } from "./types";

export function projectSnapshot(room: GameRoom, playerId: string, catalog: Catalog, now: number): Snapshot {
  const player = room.players.get(playerId)!;
  const round = room.game.round;
  const cardView = (id: string): CardView => ({ id, text: catalog.cards.get(id)!.text });
  const submission = round?.submissions.get(playerId);
  const showOptions = room.game.phase === "judging" || room.game.phase === "round_result" ||
    (room.game.phase === "finished" && round?.result !== null);
  return {
    serverNow: now,
    room: {
      code: room.code, mode: room.mode, hostPlayerId: room.hostPlayerId, settings: { ...room.settings },
      players: [...room.players.values()].map(p => ({
        id: p.id, nickname: p.nickname, score: p.score, connected: p.disconnectedAt === null, isBot: p.isBot,
      })),
      phase: room.game.phase, paused: isPaused(room), collectivelyPaused: room.game.collectivelyPaused,
      history: structuredClone(room.game.history),
      round: round ? {
        id: round.id, number: round.number, judgePlayerId: round.judgePlayerId,
        prompt: { ...cardView(round.promptCardId), pick: round.pick, draw: round.draw }, receivedCount: round.submissions.size,
        expectedCount: round.respondentPlayerIds.length,
        options: showOptions ? round.options.map(option => ({
          id: option.id, responses: option.cardIds.map(id => catalog.cards.get(id)!.text),
        })) : [],
        result: round.result ? structuredClone(round.result) : null,
        nextRoundAt: round.nextRoundAt,
        deadlineAt: round.deadlineAt, remainingPhaseMs: round.remainingPhaseMs,
        remainingResultMs: round.remainingResultMs,
      } : null,
      winnerPlayerId: room.game.winnerPlayerId, finishReason: room.game.finishReason,
    },
    self: {
      playerId, hand: player.hand.map(cardView), submitted: !!submission,
      submittedResponses: submission ? submission.cardIds.map(cardView) : [],
    },
  };
}
