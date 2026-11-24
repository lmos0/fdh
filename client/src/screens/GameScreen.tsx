import { useEffect, useRef, useState, type CSSProperties } from "react";
import { MIN_PLAYERS, type Snapshot, type SwapCost } from "../../../shared/protocol";
import { Hand } from "../components/Hand";
import { AnswerOptions, ResponseList } from "../components/AnswerOptions";
import { PlayerList } from "../components/PlayerList";
import { CardFace } from "../components/CardFace";
import { playSound } from "../audio/player";
import { PhaseClock } from "../components/PhaseClock";
import { SubmissionBar } from "../components/SubmissionBar";
import { WinningHistory } from "../components/WinningHistory";
import { chooseCard, dropCard, emptySelection, moveCard } from "../selection";
import { canAffordSwap, SwapConfirmDialog, SwapToggle } from "../components/CardSwap";
import { RoundTable } from "../components/RoundTable";
import { PlayerAvatar } from "../components/PlayerAvatar";
import { ResultParticles } from "../components/ResultParticles";
import { TableStage } from "../table/TableStage";
import { SWAP_DECK_ACTION, tableModel, type TableSwap } from "../table/model";

const SCROLL_MARGIN_PX = 32;

/** Uma carta virada por resposta esperada: mostra o andamento sem revelar quem enviou. */
function SubmissionProgress({ received, expected }: { received: number; expected: number }) {
  return <div className="submission-progress" role="img" aria-label={`${received} de ${expected} respostas recebidas`}>
    {Array.from({ length: expected }, (_, index) => <span key={index} className={`card-back ${index < received ? "received" : ""}`}>
      {index < received && <CardFace mischievous />}</span>)}
  </div>;
}

function handHeading(isJudge: boolean, submitted: boolean): string {
  if (isJudge) return "Aguarde as respostas para escolher a vencedora";
  return submitted ? "Resposta enviada" : "Sua mão";
}

export function GameScreen({ snapshot, disabled, submit, swap, judge, leave, pause, advance, restart, revealRoundId }: {
  snapshot: Snapshot; disabled: boolean;
  revealRoundId: string | null;
  submit: (roundId: string, cardIds: string[]) => void;
  swap: (roundId: string, cardId: string, cost: SwapCost) => void;
  judge: (roundId: string, optionId: string) => void;
  leave: () => void;
  pause: (roundId: string, paused: boolean) => void;
  advance: (roundId: string) => void;
  restart: (toLobby?: boolean) => void;
}) {
  const { room, self } = snapshot;
  const round = room.round;
  const [selection, setSelection] = useState(() => emptySelection(round?.prompt.pick ?? 1));
  const selectedCards = selection.slots.filter((id): id is string => id !== null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [swapMode, setSwapMode] = useState(false);
  const [swapCandidateId, setSwapCandidateId] = useState<string | null>(null);
  const [dockHeight, setDockHeight] = useState(0);
  const layout = useRef<HTMLDivElement>(null);
  const resultAnchor = useRef<HTMLElement>(null);
  const finished = room.phase === "finished";
  useEffect(() => {
    if (!round?.result?.roundId || round.result.roundId !== revealRoundId) return;
    // Quando couber, a pergunta preenchida aparece junto com a combinação vencedora.
    const result = resultAnchor.current;
    const prompt = finished ? null : layout.current?.querySelector(".prompt-stack");
    const together = result && prompt && prompt.getBoundingClientRect().top <= result.getBoundingClientRect().top
      && result.getBoundingClientRect().bottom - prompt.getBoundingClientRect().top <= window.innerHeight - SCROLL_MARGIN_PX;
    (together ? prompt : result)?.scrollIntoView({ block: "start", behavior: "auto" });
  }, [round?.result?.roundId, revealRoundId]);
  useEffect(() => {
    setSelection(emptySelection(round?.prompt.pick ?? 1));
    setSelectedOption(null);
    setSwapMode(false);
    setSwapCandidateId(null);
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  }, [round?.id, round?.prompt.pick]);
  function toggleCard(id: string) {
    if (disabled || room.paused || !round) return;
    const removing = selection.slots.includes(id);
    setSelection(previous => chooseCard(previous, id));
    playSound(removing ? "remove" : "select", { position: selection.activeIndex + 1 });
  }
  function activateSlot(activeIndex: number) { setSelection(previous => ({ ...previous, activeIndex })); }
  function moveSelection(direction: -1 | 1) {
    setSelection(previous => moveCard(previous, previous.activeIndex, direction));
    playSound("remove");
  }
  function removeSelection() {
    setSelection(previous => ({ ...previous, slots: previous.slots.map((id, index) => index === previous.activeIndex ? null : id) }));
    playSound("remove");
  }
  const isJudge = round?.judgePlayerId === self.playerId;
  const isHost = room.hostPlayerId === self.playerId;
  const hostName = room.players.find(player => player.id === room.hostPlayerId)?.nickname ?? "o anfitrião";
  const connectedCount = room.players.filter(player => player.connected).length;
  const hasEnoughPlayers = room.players.length >= MIN_PLAYERS;
  const canRestartNow = hasEnoughPlayers && connectedCount === room.players.length;
  const judgeName = room.players.find(player => player.id === round?.judgePlayerId)?.nickname ?? "O juiz";
  const locked = disabled || room.paused;
  const canSwap = room.phase === "submitting" && !isJudge && !self.submitted;
  const swapping = swapMode && canSwap && !locked;
  const swapCost: SwapCost = self.freeSwapsRemaining > 0 ? "free" : "point";
  const selfScore = room.players.find(player => player.id === self.playerId)?.score ?? 0;
  const swapCandidate = canSwap && !room.paused ? self.hand.find(card => card.id === swapCandidateId) : undefined;
  const tableSwap: TableSwap = swapping ? "active" : canSwap && canAffordSwap(swapCost, selfScore) ? "ready" : "off";
  function pickCard(id: string) {
    if (id === SWAP_DECK_ACTION) return setSwapMode(value => !value);
    if (!swapping) return toggleCard(id);
    playSound("select");
    setSwapCandidateId(id);
  }
  function confirmSwap() {
    if (!round || !swapCandidate) return;
    setSelection(previous => dropCard(previous, swapCandidate.id));
    swap(round.id, swapCandidate.id, swapCost);
    setSwapCandidateId(null);
    setSwapMode(false);
  }
  const result = round?.result;
  const ranking = [...room.players].sort((a, b) => b.score - a.score);
  const revealing = result !== null && result !== undefined && result.roundId === revealRoundId;
  const champion = room.finishReason === "target_reached";
  const finalRanking = (champion && result ? [...result.scores]
    : ranking.map(p => ({ playerId: p.id, nickname: p.nickname, score: p.score }))).sort((a, b) => b.score - a.score);
  const slotCards = selection.slots.map(id => self.hand.find(card => card.id === id) ?? null);
  const submittedTexts = self.submittedResponses.map(card => card.text);
  const promptAnswers: (string | null)[] = result ? result.responseTexts
    : room.phase === "submitting" && !isJudge ? self.submitted ? submittedTexts : slotCards.map(card => card?.text ?? null)
    : room.phase === "judging" && isJudge ? round?.options.find(option => option.id === selectedOption)?.responses ?? []
    : [];

  function inspectOption(id: string) {
    if (!isJudge || locked || room.phase !== "judging") return;
    if (selectedOption !== id) playSound("select");
    setSelectedOption(id);
  }
  return <div ref={layout} className={`room-layout game-layout phase-${room.phase}`} style={{ "--submission-dock-height": `${dockHeight}px` } as CSSProperties}>
    <TableStage model={tableModel(snapshot, selection.slots, selectedOption, disabled, promptAnswers, tableSwap)}
      title={`Mesa ${room.code}`} pick={room.phase === "judging" ? inspectOption : pickCard} />
    <div className="table-side">
      <RoundTable snapshot={snapshot} disabled={disabled} pause={pause} answers={promptAnswers} />
      <aside className="panel roster-panel"><div className="section-heading"><h2>Placar</h2><span className="count-pill">Meta: {room.settings.targetScore} pts</span></div>
        <PlayerList players={ranking} selfId={self.playerId} hostId={room.hostPlayerId} judgeId={finished ? undefined : round?.judgePlayerId}
          awardedPlayerId={result?.winnerPlayerId} celebrate={revealing} targetScore={room.settings.targetScore} />
      </aside>
    </div>
    <main className="game-main">
      {finished && <section ref={resultAnchor} className={`panel final-result ${champion ? "has-champion" : "no-champion"} ${revealing ? "is-revealing" : ""}`} aria-live="polite">
        <div className="champion-emblem">{champion && result && <PlayerAvatar nickname={result.winnerNickname} large />}
          <CardFace className="winner-face" expression={champion ? "mischievous" : "thinking"} />
          {champion && <span className="champion-star" aria-hidden="true">✦</span>}</div>
        {champion && <span className="champion-label">Campeão da partida</span>}
        <h2>{champion ? `${result?.winnerNickname ?? "Alguém"} venceu a partida!` : "A partida foi encerrada."}</h2>
        <p>{champion ? "O mau gosto encontrou seu campeão." : "Restaram menos de três participantes."}</p>
        <h3>Classificação final</h3>
        <ol className="final-ranking">{finalRanking.map((player, index) => <li key={player.playerId} className={index === 0 && champion ? "first" : ""}>
          <span className="ranking-position">{index + 1}º</span><PlayerAvatar nickname={player.nickname} />
          <span className="ranking-name">{player.nickname}</span><strong className="final-score">{player.score} {player.score === 1 ? "pt" : "pts"}</strong>
        </li>)}</ol>
        <div className="final-actions">
          {isHost ? <>
            <div className="final-action-buttons">
              {hasEnoughPlayers && <button className="button primary" onClick={() => restart(false)} disabled={disabled || !canRestartNow}>Jogar novamente</button>}
              <button className={`button ${hasEnoughPlayers ? "secondary" : "primary"}`} onClick={() => restart(true)} disabled={disabled}>Voltar à sala de espera</button>
              <button className="button ghost" onClick={leave} disabled={disabled}>Voltar para o início</button>
            </div>
            <p className="fine-print">{!hasEnoughPlayers
              ? "Volte à sala de espera para aguardar mais participantes usando o mesmo código."
              : !canRestartNow ? "Aguardando todos reconectarem para jogar novamente, ou volte à sala de espera."
              : "Reinicia a partida nesta mesma sala, mantendo o código e os participantes."}</p>
          </> : <>
            <button className="button ghost" onClick={leave} disabled={disabled}>Voltar para o início</button>
            <p className="fine-print">Aguardando {hostName} reiniciar a partida nesta mesma sala.</p>
          </>}
        </div>
      </section>}
      {round && <>
        {room.phase === "submitting" && <section className="play-section" aria-labelledby="hand-heading">
          <div className="section-heading"><h2 id="hand-heading" tabIndex={-1}>{handHeading(isJudge, self.submitted)}</h2>
            <span className="count-pill" aria-live="polite">{round.receivedCount}/{round.expectedCount} respostas</span></div>
          {isJudge ? <div className="panel waiting-panel"><SubmissionProgress received={round.receivedCount} expected={round.expectedCount} />
            <p>As respostas chegam viradas para baixo. Você só vê as combinações quando todos enviarem ou o prazo acabar.</p></div>
            : self.submitted ? <>
              <div className="panel submitted-card"><span className="submission-seal">✓ Enviada</span><ResponseList texts={submittedTexts} /></div>
              <div className="panel waiting-panel"><SubmissionProgress received={round.receivedCount} expected={round.expectedCount} />
                <p>Aguardando as outras respostas. Depois, {judgeName} escolhe a vencedora.</p></div>
            </> : <>
              {round.prompt.pick > 1 && <p className="muted hand-hint">Toque nas cartas na ordem da resposta. <span>Para trocar uma, toque no espaço dela na barra de envio.</span></p>}
              <SwapToggle active={swapping} cost={swapCost} score={selfScore} freeSwapsRemaining={self.freeSwapsRemaining} disabled={locked} onToggle={() => setSwapMode(value => !value)} />
              <Hand cards={self.hand} selectedIds={selection.slots} onSelect={pickCard} disabled={locked} swapping={swapping} />
              {swapCandidate && <SwapConfirmDialog card={swapCandidate} cost={swapCost} score={selfScore} freeSwapsRemaining={self.freeSwapsRemaining} disabled={disabled}
                onConfirm={confirmSwap} onCancel={() => setSwapCandidateId(null)} />}
              <SubmissionBar prompt={round.prompt} clock={<PhaseClock snapshot={snapshot} announce={false} compact />} slots={slotCards} activeIndex={selection.activeIndex}
                activate={activateSlot} move={moveSelection} remove={removeSelection}
                locked={locked} clear={() => { setSelection(emptySelection(round.prompt.pick)); playSound("clear"); }} submit={() => submit(round.id, selectedCards)} onHeight={setDockHeight} />
            </>}
        </section>}
        {room.phase === "judging" && <section className="play-section" aria-labelledby="judging-heading">
          <div className="section-heading"><h2 id="judging-heading">{isJudge ? "Escolha a vencedora" : `${judgeName} está escolhendo a vencedora`}</h2>
            <span className="count-pill">{round.options.length} {round.options.length === 1 ? "combinação" : "combinações"}</span></div>
          <AnswerOptions options={round.options} selectedId={selectedOption} ownTexts={submittedTexts} onSelect={inspectOption} disabled={locked || !isJudge} />
          {isJudge && <div className={`action-bar ${selectedOption ? "is-ready" : ""}`}><span>{selectedOption ? "A escolha é definitiva." : "Toque em uma combinação para escolher."}</span>
            <button className="button primary" disabled={locked || !selectedOption} onClick={() => selectedOption && judge(round.id, selectedOption)}>Escolher vencedora</button></div>}
        </section>}
        {result && <section ref={finished ? undefined : resultAnchor} className={`panel round-result ${revealing ? "is-revealing" : ""}`} aria-live="polite">
          {revealing && <ResultParticles />}
          <svg className="victory-scribble" viewBox="0 0 40 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true" focusable="false">
            <path d="m18 3 2 6 7 1-6 4 1 7-5-4-6 3 2-7-5-4 7-1 3-5ZM29 5l5-2m-3 9 6 2M4 19l-2 3" />
          </svg>
          <h2>{finished ? "Última combinação vencedora" : "Combinação vencedora"}</h2>
          <span className="card-label">+1 ponto</span><ResponseList texts={result.responseTexts} />
          <div className="winner-identity"><PlayerAvatar nickname={result.winnerNickname} />
            <div><small>Quem cometeu essa</small><strong className="winner-name">{result.winnerNickname}</strong></div><CardFace expression="mischievous" /></div>
          {!finished && <div className="result-next"><div><PhaseClock snapshot={snapshot} announce={false} />
            {room.paused && <p className="muted">Intervalo congelado durante a pausa.</p>}</div>
            {room.phase === "round_result" && room.hostPlayerId === self.playerId && <button className="button primary advance-round" disabled={locked} onClick={() => advance(round.id)}>Próxima rodada</button>}</div>}
        </section>}
      </>}
    </main>
    <WinningHistory history={room.history} />
  </div>;
}
