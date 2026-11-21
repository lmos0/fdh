import { useEffect, useMemo, useState } from "react";
import type { RoomPublicState, Snapshot } from "../../../shared/protocol";

const TICK_MS = 250;
const MS_PER_SECOND = 1_000;
const NEAR_END_SECONDS = 10;

type ClockRound = NonNullable<RoomPublicState["round"]>;

function remainingMs(round: ClockRound, paused: boolean, isResult: boolean, serverNow: number, localElapsedMs: number): number | null {
  if (paused) return isResult ? round.remainingResultMs : round.remainingPhaseMs;
  const deadline = isResult ? round.nextRoundAt : round.deadlineAt;
  if (deadline === null) return null;
  return Math.max(0, deadline - serverNow - localElapsedMs);
}

function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function clockLabel(paused: boolean, isResult: boolean): string {
  if (paused) return "Tempo congelado";
  return isResult ? "Próxima rodada em" : "Tempo da fase";
}

function clockText(time: string | null, label: string, isResult: boolean): string {
  if (time !== null) return `${label}: ${time}`;
  return isResult ? "O anfitrião avança a próxima rodada" : "Sem limite de tempo";
}

function warningText(nearEnd: boolean, seconds: number | null): string {
  if (!nearEnd) return "";
  return seconds === 0 ? "Prazo encerrado. Aguardando o servidor…" : "O prazo está acabando.";
}

export function PhaseClock({ snapshot, announce = true, compact = false }: {
  snapshot: Pick<Snapshot, "room" | "serverNow">; announce?: boolean; compact?: boolean;
}) {
  const { room, serverNow } = snapshot;
  const baseline = useMemo(() => performance.now(), [snapshot]);
  const [tick, setTick] = useState(baseline);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(performance.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  if (room.phase !== "submitting" && room.phase !== "judging" && room.phase !== "round_result") return null;
  const round = room.round!;
  const isResult = room.phase === "round_result";
  const remaining = remainingMs(round, room.paused, isResult, serverNow, Math.max(0, tick - baseline));
  const seconds = remaining === null ? null : Math.ceil(remaining / MS_PER_SECOND);
  const nearEnd = !isResult && !room.paused && seconds !== null && seconds <= NEAR_END_SECONDS;
  const time = seconds === null ? null : formatClock(seconds);
  const label = clockLabel(room.paused, isResult);
  if (compact) {
    if (time === null) return null;
    return <div className={`phase-clock compact ${nearEnd ? "near-end" : ""} ${room.paused ? "frozen" : ""}`}
      role="timer" aria-label={`${label}: ${time}`}><ClockIcon /><span aria-hidden="true">{time}</span></div>;
  }
  const totalSeconds = isResult ? room.settings.resultIntervalSeconds : room.settings.phaseTimeLimitSeconds;
  const fraction = remaining === null || !totalSeconds ? null : Math.min(1, remaining / (totalSeconds * MS_PER_SECOND));
  return <div className={`phase-clock ${nearEnd ? "near-end" : ""} ${room.paused ? "frozen" : ""}`}>
    <span className="clock-label"><ClockIcon /><span>{clockText(time, label, isResult)}</span></span>
    {fraction !== null && <span className="clock-track" aria-hidden="true"><span style={{ transform: `scaleX(${fraction})` }} /></span>}
    <span className="clock-warning" role={announce ? "status" : undefined}>{warningText(nearEnd, seconds)}</span>
  </div>;
}

function ClockIcon() {
  return <svg className="clock-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" />
  </svg>;
}
