import { RECONNECT_GRACE_SECONDS, type GamePhase, type Snapshot } from "../../../shared/protocol";
import { CardFace, type Mood } from "./CardFace";
import { FilledPrompt } from "./FilledPrompt";
import { JudgeIcon } from "./JudgeIcon";
import { PhaseClock } from "./PhaseClock";

// O lobby nunca chega aqui; seus valores apenas mantêm as tabelas completas.
const PHASE_TITLES = {
  lobby: "Resultado", submitting: "Respostas", judging: "Julgamento", round_result: "Resultado", finished: "Fim de jogo",
} as const satisfies Record<GamePhase, string>;
const PHASE_STEPS = {
  lobby: 2, submitting: 0, judging: 1, round_result: 2, finished: 2,
} as const satisfies Record<GamePhase, number>;
const PHASE_EXPRESSIONS = {
  lobby: "mischievous", submitting: "thinking", judging: "suspicious", round_result: "mischievous", finished: "mischievous",
} as const satisfies Record<GamePhase, Mood>;

function submittingInstruction(isJudge: boolean, submitted: boolean, pick: number | undefined): string {
  if (isJudge) return "Aguarde as respostas";
  if (submitted) return "Resposta enviada. Aguarde o julgamento.";
  return `Escolha ${pick} ${pick === 1 ? "carta" : "cartas"}`;
}

function roundInstruction(snapshot: Snapshot, isJudge: boolean, judgeName: string): string {
  const { room, self } = snapshot;
  if (room.phase === "finished") return "Partida encerrada";
  if (room.paused) return "Partida pausada · tempo congelado";
  if (room.phase === "submitting") return submittingInstruction(isJudge, self.submitted, room.round?.prompt.pick);
  if (room.phase === "judging") return isJudge ? "Sua vez de julgar" : `Aguarde a escolha de ${judgeName}`;
  return "A combinação vencedora";
}

export function RoundTable({ snapshot, disabled, pause, answers }: {
  snapshot: Snapshot; disabled: boolean; pause: (roundId: string, paused: boolean) => void;
  /** Cartas que preenchem as lacunas da pergunta: seleção atual, opção em análise ou vencedora. */
  answers: (string | null)[];
}) {
  const { room, self } = snapshot;
  const round = room.round;
  const finished = room.phase === "finished";
  const isJudge = round?.judgePlayerId === self.playerId;
  const judgeName = room.players.find(player => player.id === round?.judgePlayerId)?.nickname ?? "O juiz";
  const phaseTitle = PHASE_TITLES[room.phase];
  const step = PHASE_STEPS[room.phase];
  const instruction = roundInstruction(snapshot, isJudge, judgeName);
  const offline = room.players.filter(player => !player.connected);
  const expression: Mood = offline.length ? "sleepy" : PHASE_EXPRESSIONS[room.phase];
  // Enquanto a pessoa escolhe, a quantidade já aparece na pergunta e na barra de envio.
  const choosing = room.phase === "submitting" && !isJudge && !self.submitted && !room.paused;

  return <section className={`round-table felt ${finished ? "is-finished" : ""} ${choosing ? "is-choosing" : ""}`} aria-label="Mesa da rodada">
    <div className="game-heading"><div>{round && <span className="round-number">Rodada {round.number}</span>}<h1>{phaseTitle}</h1></div>
      {round && !finished && <button className="button secondary small pause-button" disabled={disabled}
        aria-label={room.collectivelyPaused ? "Retomar para todos" : "Pausar para todos"}
        onClick={() => pause(round.id, !room.collectivelyPaused)}>
        <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true" focusable="false">
          {room.collectivelyPaused ? <path d="M2.5 1.2v9.6L10.5 6Z" /> : <path d="M2 1h3v10H2zM7 1h3v10H7z" />}</svg>
        {room.collectivelyPaused ? "Retomar" : "Pausar"}</button>}
    </div>
    {round && !finished && <ol className="phase-steps" aria-label="Fases da rodada">
      {["Responder", "Julgar", "Resultado"].map((label, index) => <li key={label}
        className={index < step ? "completed" : ""} aria-current={index === step ? "step" : undefined}>
        <span className="step-number" aria-hidden="true">{index + 1}</span>{label}
      </li>)}
    </ol>}
    {!finished && <div className="game-tools"><PhaseClock snapshot={snapshot} /></div>}
    {room.collectivelyPaused && !finished && <div className="banner info" role="status">Pausa coletiva. Qualquer participante pode retomar. Os prazos estão congelados.</div>}
    {room.paused && offline.length > 0 && <div className="banner warning" role="status">Partida pausada. Aguardando {offline.map(player => player.nickname).join(", ")} reconectar, por até {RECONNECT_GRACE_SECONDS} segundos.</div>}
    {round && <>
      {!finished && <div className={`round-judge ${isJudge ? "is-self" : ""}`} role="status" aria-label="Juiz da rodada" aria-atomic="true">
        <span className="round-judge-icon"><JudgeIcon /></span>
        <span>{isJudge ? <strong>Você é o juiz desta rodada</strong> : <>Juiz da rodada: <strong>{judgeName}</strong></>}</span>
      </div>}
      <div className="prompt-stack"><section className={`prompt-card ${round.result ? "is-result" : ""}`} aria-label="Pergunta da rodada">
        <div className="prompt-meta"><span className="prompt-label"><CardFace expression={expression} />{finished ? "Última pergunta" : "Pergunta"}</span></div>
        <h2><FilledPrompt text={round.prompt.text} answers={answers} /></h2>
        <div className="prompt-meta prompt-rules"><span>Escolha {round.prompt.pick} {round.prompt.pick === 1 ? "carta" : "cartas"}</span>{round.prompt.draw > 0 && <span>+{round.prompt.draw} cartas extras</span>}</div>
      </section></div>
      {!finished && <p className="main-instruction" role="status"><CardFace expression={expression} />{instruction}</p>}
    </>}
  </section>;
}
