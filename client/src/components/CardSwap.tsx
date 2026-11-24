import { useEffect, useId, useRef } from "react";
import { FREE_SWAPS_PER_GAME, SWAP_COST_POINTS, type CardView, type SwapCost } from "../../../shared/protocol";
import { pointsLabel } from "../points";

export function canAffordSwap(cost: SwapCost, score: number): boolean {
  return cost === "free" || score >= SWAP_COST_POINTS;
}

function freeSwapsLabel(remaining: number): string {
  return remaining === 1 ? "1 troca grátis restante" : `${remaining} trocas grátis restantes`;
}

function swapCaption(cost: SwapCost, score: number, freeSwapsRemaining: number): string {
  if (!canAffordSwap(cost, score)) return "Sem pontos para trocar";
  return cost === "free" ? freeSwapsLabel(freeSwapsRemaining) : `Custa ${pointsLabel(SWAP_COST_POINTS)}`;
}

export function SwapToggle({ active, cost, score, freeSwapsRemaining, disabled, onToggle }: {
  active: boolean; cost: SwapCost; score: number; freeSwapsRemaining: number; disabled: boolean; onToggle: () => void;
}) {
  const captionId = useId();
  const isFree = cost === "free";
  // A explicação só aparece até o primeiro uso: quem já trocou sabe que a opção existe.
  const neverSwapped = freeSwapsRemaining === FREE_SWAPS_PER_GAME;
  return <div className={`swap-row ${isFree ? "is-free" : ""} ${active ? "is-active" : ""}`}>
    {neverSwapped && <p className="swap-intro">Não curtiu alguma carta? Troque por outra do monte.</p>}
    <button type="button" className="button small swap-toggle" aria-pressed={active} aria-describedby={captionId}
      disabled={disabled || !canAffordSwap(cost, score)} onClick={onToggle}>
      <span className="swap-icon" aria-hidden="true">⇄</span>Trocar carta</button>
    <span id={captionId} className="swap-caption">{swapCaption(cost, score, freeSwapsRemaining)}</span>
    {active && <p className="swap-hint" role="status">Toque na carta que você quer descartar.</p>}
  </div>;
}

const CONFIRM_LABELS = {
  free: "Usar troca grátis",
  point: `Trocar por ${pointsLabel(SWAP_COST_POINTS)}`,
} as const satisfies Record<SwapCost, string>;

function freeSwapWarning(remaining: number): string {
  if (remaining === 1) return "Você vai usar sua última troca gratuita da partida. As próximas trocas custarão pontos. Confirmar?";
  return `Você vai usar uma troca gratuita da partida. Depois desta, ${freeSwapsLabel(remaining - 1)}. Confirmar?`;
}

function swapWarning(cost: SwapCost, score: number, freeSwapsRemaining: number): string {
  if (cost === "free") return freeSwapWarning(freeSwapsRemaining);
  return `Esta troca vai custar ${pointsLabel(SWAP_COST_POINTS)} do seu placar (você tem ${pointsLabel(score)}). `
    + "Todos os participantes serão avisados. Tem certeza?";
}

export function SwapConfirmDialog({ card, cost, score, freeSwapsRemaining, disabled, onConfirm, onCancel }: {
  card: CardView; cost: SwapCost; score: number; freeSwapsRemaining: number; disabled: boolean; onConfirm: () => void; onCancel: () => void;
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
    <p id={warningId} className={`swap-warning ${cost === "point" ? "is-paid" : ""}`}>{swapWarning(cost, score, freeSwapsRemaining)}</p>
    <div className="swap-actions">
      <button type="button" className="button ghost" onClick={onCancel}>Cancelar</button>
      <button type="button" className="button primary" disabled={disabled} onClick={onConfirm}>{CONFIRM_LABELS[cost]}</button>
    </div>
  </dialog>;
}
