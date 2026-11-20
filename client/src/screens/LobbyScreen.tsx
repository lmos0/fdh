import { useEffect, useState, type FormEvent } from "react";
import type { Settings, Snapshot } from "../../../shared/protocol";
import { PlayerList } from "../components/PlayerList";
import { PHASE_TIME_LIMITS, RESULT_INTERVALS } from "../../../shared/protocol";
import { CardFace } from "../components/CardFace";
import { TableStage } from "../table/TableStage";
import { tableModel } from "../table/model";

const MIN_PLAYERS = 3;

export function LobbyScreen({ snapshot, disabled, configure, start, copyInvite, copied }: {
  snapshot: Snapshot; disabled: boolean; configure: (settings: Settings) => void; start: () => void;
  copyInvite: () => void; copied: boolean;
}) {
  const { room, self } = snapshot;
  const isHost = room.hostPlayerId === self.playerId;
  const hostName = room.players.find(player => player.id === room.hostPlayerId)?.nickname ?? "o anfitrião";
  const [targetScore, setTargetScore] = useState(String(room.settings.targetScore));
  useEffect(() => setTargetScore(String(room.settings.targetScore)), [room.settings.targetScore]);
  const [timeLimit, setTimeLimit] = useState(String(room.settings.phaseTimeLimitSeconds ?? "none"));
  useEffect(() => setTimeLimit(String(room.settings.phaseTimeLimitSeconds ?? "none")), [room.settings.phaseTimeLimitSeconds]);
  const [resultInterval, setResultInterval] = useState(String(room.settings.resultIntervalSeconds ?? "manual"));
  useEffect(() => setResultInterval(String(room.settings.resultIntervalSeconds ?? "manual")), [room.settings.resultIntervalSeconds]);
  const connectedCount = room.players.filter(player => player.connected).length;
  const missing = Math.max(0, MIN_PLAYERS - room.players.length);
  const unchanged = Number(targetScore) === room.settings.targetScore && timeLimit === String(room.settings.phaseTimeLimitSeconds ?? "none")
    && resultInterval === String(room.settings.resultIntervalSeconds ?? "manual");
  function save(event: FormEvent) { event.preventDefault(); configure({ targetScore: Number(targetScore),
    phaseTimeLimitSeconds: timeLimit === "none" ? null : Number(timeLimit),
    resultIntervalSeconds: resultInterval === "manual" ? null : Number(resultInterval) }); }

  return <div className="room-layout lobby-layout">
    <section className="panel lobby-main">
      <h1 className="cast-heading"><CardFace expression="curious" />Sala de espera</h1>
      {room.mode === "test" ? <div className="lobby-invite"><div><span>Participantes</span><strong className="test-participants">Você + 2 bots</strong></div></div>
        : <div className="lobby-invite"><div><span>Código da sala</span><strong>{room.code}</strong></div>
          <button type="button" className="button secondary" onClick={copyInvite}>{copied ? "Convite copiado!" : "Copiar convite"}</button></div>}
      {isHost ? <>
        <form className="settings-form" onSubmit={save}>
          <h2>Configurações da partida</h2>
          <div className="settings-grid">
            <div className="field"><label htmlFor="phase-time-limit">Tempo por fase</label>
              <select id="phase-time-limit" value={timeLimit} onChange={event => setTimeLimit(event.target.value)} disabled={disabled}>
                {PHASE_TIME_LIMITS.map(seconds => <option key={seconds} value={seconds}>{seconds} segundos</option>)}
                <option value="none">Sem limite</option>
              </select></div>
            <div className="field"><label htmlFor="result-interval">Tempo para apreciar o resultado</label>
              <select id="result-interval" value={resultInterval} onChange={event => setResultInterval(event.target.value)} disabled={disabled}>
                {RESULT_INTERVALS.map(seconds => <option key={seconds} value={seconds}>{seconds} segundos</option>)}
                <option value="manual">Anfitrião avança manualmente</option>
              </select></div>
            <div className="field"><label htmlFor="target-score">Pontos para vencer</label>
              <div className="inline-fields"><input id="target-score" type="number" inputMode="numeric" enterKeyHint="done" min={3} max={20} step={1} required
                value={targetScore} onChange={event => setTargetScore(event.target.value)} disabled={disabled} />
                <button className="button secondary" disabled={disabled || unchanged}>Salvar</button></div></div>
          </div>
          <p className="fine-print">Um prazo para responder e outro para julgar. Ambos congelam durante pausas.</p>
        </form>
        <button type="button" className="button primary full start-button" onClick={start}
          disabled={disabled || room.players.length < MIN_PLAYERS || connectedCount !== room.players.length}>Começar a partida</button>
        {missing > 0 && <p className="fine-print start-hint">Faltam {missing} participante(s) para começar.</p>}
        {connectedCount !== room.players.length && <p className="fine-print start-hint">Aguardando todos reconectarem.</p>}
      </> : <div className="waiting-message">
        <dl className="settings-summary">
          <div><dt>Tempo por fase</dt><dd>{room.settings.phaseTimeLimitSeconds === null ? "Sem limite" : `${room.settings.phaseTimeLimitSeconds} segundos`}</dd></div>
          <div><dt>Resultado</dt><dd>{room.settings.resultIntervalSeconds === null ? "Avanço pelo anfitrião" : `${room.settings.resultIntervalSeconds} segundos`}</dd></div>
          <div><dt>Pontos para vencer</dt><dd>{room.settings.targetScore}</dd></div>
        </dl>
        <p role="status">Aguardando {hostName} iniciar a partida…</p>
      </div>}
      <details className="rules-summary">
        <summary>Regras</summary>
        <ul><li>Cada pessoa começa com 7 cartas de resposta.</li><li>A pergunta indica se você escolhe 1, 2 ou 3 cartas.</li><li>DRAW 2 dá 2 cartas extras antes da escolha.</li><li>O juiz escolhe a melhor combinação sem ver o autor.</li><li>O vencedor ganha 1 ponto e o juiz muda.</li><li>Quem chegar a {room.settings.targetScore} pontos vence.</li></ul>
        <ul><li>O limite vale separadamente para responder e julgar. Sem limite, a fase aguarda todos.</li>
          <li>No fim do prazo, respostas ausentes ficam de fora. Se ninguém respondeu ou o juiz não escolher, a rodada é cancelada sem pontos e o juiz muda.</li>
          <li>Qualquer participante pode pausar ou retomar para o grupo. Desconexões também congelam os prazos; retomar não remove a pausa por desconexão.</li></ul>
        <p>O anfitrião pode avançar o resultado antes do intervalo ou escolher avanço apenas manual. As últimas 30 combinações vencedoras ficam no histórico da partida.</p>
      </details>
    </section>
    <aside><TableStage model={tableModel(snapshot)} title="Lugares à mesa" />
    <div className="panel roster-panel"><div className="section-heading"><h2>Jogadores</h2><span className="count-pill">{room.players.length}/8</span></div>
      <PlayerList players={room.players} selfId={self.playerId} hostId={room.hostPlayerId} />
      {missing > 0 && <ul className="empty-seats" aria-hidden="true">{Array.from({ length: missing }, (_, index) => <li key={index}><span className="seat-mark">+</span>Aguardando jogador…</li>)}</ul>}
    </div></aside>
  </div>;
}
