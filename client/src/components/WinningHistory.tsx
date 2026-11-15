import type { WinningCombination } from "../../../shared/protocol";
import { ResponseList } from "./AnswerOptions";
import { FilledPrompt, fillsInline } from "./FilledPrompt";
import { PlayerAvatar } from "./PlayerAvatar";

export function WinningHistory({ history }: { history: WinningCombination[] }) {
  if (!history.length) return null;
  return <details className="winning-history panel">
    <summary>Histórico de vencedoras <span className="count-pill">{history.length}</span></summary>
    <ol className="history-list">{[...history].reverse().map(entry => <li key={entry.result.roundId}>
      <span className="history-author"><PlayerAvatar nickname={entry.result.winnerNickname} />Rodada {entry.roundNumber} · {entry.result.winnerNickname}</span>
      <p className="history-prompt"><FilledPrompt text={entry.prompt.text} answers={entry.result.responseTexts} /></p>
      {/* Sem lacunas para preencher, as cartas aparecem abaixo da pergunta. */}
      {!fillsInline(entry.prompt.text, entry.result.responseTexts.length) && <div className="history-response"><ResponseList texts={entry.result.responseTexts} /></div>}
    </li>)}</ol>
    <p className="fine-print">Últimas 30 combinações vencedoras desta partida. Rodadas canceladas não entram no histórico.</p>
  </details>;
}
