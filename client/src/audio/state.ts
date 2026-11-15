import type { Snapshot } from "../../../shared/protocol";

export type SoundName = "select" | "remove" | "clear" | "submit" | "round" | "judge" |
  "judge_ready" | "judging" | "judge_confirm" | "point" | "result" | "victory" | "ending" | "judge_ending";
export interface SoundPreferences { enabled: boolean; volume: number }
export const SOUND_STORAGE_KEY = "fdh.audio";
export const DEFAULT_SOUND_PREFERENCES: SoundPreferences = { enabled: true, volume: .35 };

export function soundPreferences(value: unknown): SoundPreferences {
  const input = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    enabled: typeof input.enabled === "boolean" ? input.enabled : DEFAULT_SOUND_PREFERENCES.enabled,
    volume: typeof input.volume === "number" && Number.isFinite(input.volume)
      ? Math.max(0, Math.min(1, input.volume)) : DEFAULT_SOUND_PREFERENCES.volume,
  };
}

/** Guarda somente marcadores de estado; nunca mãos, opções ou textos de cartas. */
export function createGameSoundTracker() {
  type Marker = ReturnType<typeof marker>;
  function marker(snapshot: Snapshot) {
    return {
      roomCode: snapshot.room.code, playerId: snapshot.self.playerId,
      roundId: snapshot.room.round?.id, judgeId: snapshot.room.round?.judgePlayerId,
      resultId: snapshot.room.round?.result?.roundId, phase: snapshot.room.phase,
      winnerId: snapshot.room.winnerPlayerId, finishReason: snapshot.room.finishReason,
      submitted: snapshot.self.submitted, paused: snapshot.room.paused,
    };
  }
  let previous: Marker | null = null;
  return {
    resync() { previous = null; },
    observe(snapshot: Snapshot): SoundName | null {
      const next = marker(snapshot);
      const before = previous;
      // Consumir mesmo quando o som está mudo ou a aba está oculta, sem reproduzir atrasados.
      previous = next;
      if (!before || before.roomCode !== next.roomCode || before.playerId !== next.playerId || next.paused) return null;
      if (next.resultId && next.resultId !== before.resultId) {
        if (next.phase === "finished" && next.finishReason === "target_reached") {
          if (next.winnerId === next.playerId) return "victory";
          return next.roundId === before.roundId && before.phase === "judging" && next.judgeId === next.playerId ? "judge_ending" : "ending";
        }
        if (next.roundId === before.roundId && before.phase === "judging" && next.judgeId === next.playerId) return "judge_confirm";
        return snapshot.room.round?.result?.winnerPlayerId === next.playerId ? "point" : "result";
      }
      if (next.roundId && next.roundId !== before.roundId && next.phase === "submitting") {
        return next.judgeId === next.playerId ? "judge" : "round";
      }
      if (next.roundId === before.roundId && next.submitted && !before.submitted) return "submit";
      if (next.roundId === before.roundId && before.phase === "submitting" && next.phase === "judging") {
        return next.judgeId === next.playerId ? "judge_ready" : "judging";
      }
      return null;
    },
  };
}
