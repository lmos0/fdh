import type { CardView } from "../../../shared/protocol";
import { CardFace } from "./CardFace";

export function Hand({ cards, selectedIds, onSelect, disabled, swapping = false }: {
  cards: CardView[]; selectedIds: (string | null)[]; onSelect: (id: string) => void; disabled: boolean; swapping?: boolean;
}) {
  return <div className={`card-grid hand-grid ${swapping ? "is-swapping" : ""}`}>
    {cards.map(card => {
      const order = selectedIds.indexOf(card.id);
      return <button key={card.id} className={`answer-card ${order !== -1 ? "selected" : ""}`}
        type="button" aria-pressed={order !== -1} disabled={disabled} onClick={() => onSelect(card.id)}>
        {order !== -1 && <small className="selection-order">{order + 1}<span className="sr-only">ª escolha</span></small>}
        <span>{card.text}</span><CardFace className="card-mark" />
      </button>;
    })}
  </div>;
}
