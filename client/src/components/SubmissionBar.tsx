import { useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import type { CardView, PromptView } from "../../../shared/protocol";
import { ResponseList } from "./AnswerOptions";
import { FilledPrompt } from "./FilledPrompt";

export function SubmissionBar({ prompt, slots, activeIndex, activate, move, remove, locked, clear, submit, onHeight, clock }: {
  prompt: PromptView; slots: (CardView | null)[]; activeIndex: number; locked: boolean;
  activate: (index: number) => void; move: (direction: -1 | 1) => void; remove: () => void;
  clear: () => void; submit: () => void; onHeight: (height: number) => void;
  clock: ReactNode;
}) {
  const selected = slots.filter((card): card is CardView => card !== null);
  const [reviewing, setReviewing] = useState(false);
  const reviewId = useId();
  const bar = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = bar.current!;
    const observer = new ResizeObserver(() => onHeight(element.getBoundingClientRect().height));
    observer.observe(element);
    return () => observer.disconnect();
  }, [onHeight]);
  const position = `${activeIndex + 1}ª carta`;
  const missing = prompt.pick - selected.length;
  return <div className="submission-slot">
    <div className="submission-dock" ref={bar} role="region" aria-label="Seleção e envio">
      <div className="dock-top">
        <button type="button" className="dock-question" aria-expanded={reviewing} aria-controls={reviewId}
          onClick={() => setReviewing(value => !value)}>
          <span className="dock-question-label">Pergunta</span>
          <span className="dock-question-text"><FilledPrompt text={prompt.text} /></span>
        </button>
        <span className="dock-title" role="status">Sua combinação <small>{selected.length}/{prompt.pick}</small></span>
        <div className="dock-clock">{clock}</div>
        <button type="button" className="button ghost small dock-clear" aria-label="Limpar seleção"
          disabled={locked || !selected.length} onClick={clear}>Limpar</button>
      </div>
      {reviewing && <div className="dock-review" id={reviewId}>
        <p><FilledPrompt text={prompt.text} answers={slots.map(card => card?.text ?? null)} /></p>
        <ResponseList texts={slots.map((card, index) => card?.text ?? `[${index + 1}ª carta ainda não escolhida]`)} />
      </div>}
      <div className={`dock-main ${prompt.pick === 1 ? "single" : ""}`}>
        <div className={`combination-slots slots-${slots.length}`} role="group" aria-label="Espaços da combinação">
          {slots.map((card, index) => <button type="button" key={index}
            className={`slot-button ${card ? "filled" : "empty"} ${index === activeIndex ? "active" : ""}`}
            disabled={locked} aria-pressed={index === activeIndex} aria-label={`${index + 1}ª carta: ${card?.text ?? "vazia"}`}
            onClick={() => activate(index)}>
            <span className="slot-number">{index + 1}</span>
            <span className="slot-text">{card?.text ?? "Escolha uma carta"}</span>
          </button>)}
        </div>
        <div className="dock-actions">
          {prompt.pick > 1 && <div className="slot-tools" role="group" aria-label={`Editar ${position}`}>
            <button type="button" className="button ghost small icon-button" aria-label={`Mover ${position} para antes`} title="Mover para antes"
              disabled={locked || activeIndex === 0 || !slots[activeIndex]} onClick={() => move(-1)}>←</button>
            <button type="button" className="button ghost small icon-button" aria-label={`Mover ${position} para depois`} title="Mover para depois"
              disabled={locked || activeIndex === prompt.pick - 1 || !slots[activeIndex]} onClick={() => move(1)}>→</button>
            <button type="button" className="button ghost small icon-button" aria-label="Remover" title={`Remover ${position}`}
              disabled={locked || !slots[activeIndex]} onClick={remove}>✕</button>
          </div>}
          <button type="button" className="button primary dock-send" disabled={locked || missing !== 0} onClick={submit}>Enviar resposta</button>
        </div>
      </div>
      <p className="send-warning">{missing > 0 && <strong className="send-missing">{missing === 1 ? "Falta 1 carta." : `Faltam ${missing} cartas.`}</strong>}
        <span>Após enviar, não será possível alterar.</span></p>
    </div>
  </div>;
}
