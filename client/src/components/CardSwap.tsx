import { useEffect, useId, useRef } from "react";
import { SWAP_COST_POINTS, type CardView, type SwapCost } from "../../../shared/protocol";
import { pointsLabel } from "../points";

export function canAffordSwap(cost: SwapCost, score: number): boolean {
  return cost === "free" || score >= SWAP_COST_POINTS;
}

function swapCaption(cost: SwapCost, score: number): string {
  if (!canAffordSwap(cost, score)) return "Sem pontos para trocar";
  return cost === "free" ? "1 troca grátis na partida" : `Custa ${pointsLabel(SWAP_COST_POINTS)}`;
}

export function SwapToggle({ active, cost, score, disabled, onToggle }: {
  active: boolean; cost: SwapCost; score: number; disabled: boolean; onToggle: () => void;
}) {
  const captionId = useId();
  return <div className={`swap-row ${active ? "is-active" : ""}`}>
    <button type="button" className="button secondary small swap-toggle" aria-pressed={active} aria-describedby={captionId}
      disabled={disabled || !canAffordSwap(cost, score)} onClick={onToggle}>Trocar carta</button>
    <span id={captionId} className="swap-caption">{swapCaption(cost, score)}</span>
    {active && <p className="swap-hint" role="status">Toque na carta que você quer descartar.</p>}
  </div>;
}

const CONFIRM_LABELS = {
  free: "Usar troca grátis",
  point: `Trocar por ${pointsLabel(SWAP_COST_POINTS)}`,
} as const satisfies Record<SwapCost, string>;

function swapWarning(cost: SwapCost, score: number): string {
  if (cost === "free") return "Você vai usar sua única troca gratuita da partida. As próximas trocas custarão pontos. Confirmar?";
  return `Esta troca vai custar ${pointsLabel(SWAP_COST_POINTS)} do seu placar (você tem ${pointsLabel(score)}). `
    + "Todos os participantes serão avisados. Tem certeza?";
}

export function SwapConfirmDialog({ card, cost, score, disabled, onConfirm, onCancel }: {
  card: CardView; cost: SwapCost; score: number; disabled: boolean; onConfirm: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const warningId = useId();
  useEffect(() => {
    const element = dialog.current!;
    // showModal prende o foco no diálogo e permite cancelar com Esc.
    if (!element.open) element.showModal();
    return () => element.close();
  }, []);
  return <dialog ref={dialog} className="swap-dialog panel" aria-labelledby={titleId} aria-describedby={warningId}
    onCancel={event => { event.preventDefault(); onCancel(); }}>
    <h2 id={titleId}>Trocar esta carta?</h2>
    <p className="swap-card-text">{card.text}</p>
    <p id={warningId} className={`swap-warning ${cost === "point" ? "is-paid" : ""}`}>{swapWarning(cost, score)}</p>
    <div className="swap-actions">
      <button type="button" className="button ghost" onClick={onCancel}>Cancelar</button>
      <button type="button" className="button primary" disabled={disabled} onClick={onConfirm}>{CONFIRM_LABELS[cost]}</button>
    </div>
  </dialog>;
}
