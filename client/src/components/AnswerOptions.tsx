import type { AnswerOptionView } from "../../../shared/protocol";
import { CardFace } from "./CardFace";

export function ResponseList({ texts }: { texts: string[] }) {
  return <ol className="response-list">{texts.map((text, index) => <li key={index}>{text}</li>)}</ol>;
}

export function AnswerOptions({ options, selectedId, onSelect, disabled, ownTexts }: {
  options: AnswerOptionView[]; selectedId: string | null; onSelect: (id: string) => void; disabled: boolean;
  /** Cartas enviadas por quem está vendo, para reconhecer a própria combinação entre as anônimas. */
  ownTexts?: string[];
}) {
  const own = ownTexts?.length ? JSON.stringify(ownTexts) : null;
  return <div className="card-grid option-grid">
    {options.map((option, index) => <button key={option.id} type="button"
      className={`answer-card answer-group ${selectedId === option.id ? "selected" : ""}`}
      aria-pressed={selectedId === option.id} onClick={() => onSelect(option.id)} disabled={disabled}>
      <ResponseList texts={option.responses} />
      <div className="answer-footer"><small>Combinação {index + 1}</small>
        {JSON.stringify(option.responses) === own ? <small className="own-mark">Sua resposta</small> : <CardFace className="card-mark" mischievous />}</div>
    </button>)}
  </div>;
}
