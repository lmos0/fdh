import { useEffect, useMemo, useState } from "react";
import type { Snapshot } from "../../../shared/protocol";

export function PhaseClock({ snapshot, announce = true, compact = false }: { snapshot: Snapshot; announce?: boolean; compact?: boolean }) {
  const { room, serverNow } = snapshot;
  const baseline = useMemo(() => performance.now(), [snapshot]);
  const [tick, setTick] = useState(baseline);
  useEffect(() => {
    const timer = window.setInterval(() => setTick(performance.now()), 250);
    return () => window.clearInterval(timer);
  }, []);
  if (room.phase !== "submitting" && room.phase !== "judging" && room.phase !== "round_result") return null;
  const round = room.round!;
  const isResult = room.phase === "round_result";
  const deadline = isResult ? round.nextRoundAt : round.deadlineAt;
  const remaining = room.paused ? isResult ? round.remainingResultMs : round.remainingPhaseMs : deadline === null ? null
    : Math.max(0, deadline - serverNow - Math.max(0, tick - baseline));
  const seconds = remaining === null ? null : Math.ceil(remaining / 1_000);
  const nearEnd = !isResult && !room.paused && seconds !== null && seconds <= 10;
  const time = seconds === null ? null : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  const label = room.paused ? "Tempo congelado" : isResult ? "Próxima rodada em" : "Tempo da fase";
  if (compact) {
    if (time === null) return null;
    return <div className={`phase-clock compact ${nearEnd ? "near-end" : ""} ${room.paused ? "frozen" : ""}`}
      role="timer" aria-label={`${label}: ${time}`}><ClockIcon /><span aria-hidden="true">{time}</span></div>;
  }
  const totalSeconds = isResult ? room.settings.resultIntervalSeconds : room.settings.phaseTimeLimitSeconds;
  const fraction = remaining === null || !totalSeconds ? null : Math.min(1, remaining / (totalSeconds * 1_000));
  return <div className={`phase-clock ${nearEnd ? "near-end" : ""} ${room.paused ? "frozen" : ""}`}>
    <span className="clock-label"><ClockIcon /><span>{time === null ? isResult ? "O anfitrião avança a próxima rodada" : "Sem limite de tempo" : `${label}: ${time}`}</span></span>
    {fraction !== null && <span className="clock-track" aria-hidden="true"><span style={{ transform: `scaleX(${fraction})` }} /></span>}
    <span className="clock-warning" role={announce ? "status" : undefined}>{nearEnd ? seconds === 0 ? "Prazo encerrado. Aguardando o servidor…" : "O prazo está acabando." : ""}</span>
  </div>;
}

function ClockIcon() {
  return <svg className="clock-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2M9 2h6" />
  </svg>;
}
