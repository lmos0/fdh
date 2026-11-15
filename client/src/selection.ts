export interface Selection { slots: (string | null)[]; activeIndex: number }
export function emptySelection(pick: number): Selection {
  return { slots: Array.from({ length: pick }, () => null), activeIndex: 0 };
}
export function chooseCard(selection: Selection, cardId: string): Selection {
  const slots = [...selection.slots];
  const previous = slots.indexOf(cardId);
  if (previous !== -1) {
    slots[previous] = null;
    return { slots, activeIndex: previous };
  }
  slots[selection.activeIndex] = cardId;
  const empty = slots.indexOf(null);
  return { slots, activeIndex: empty === -1 ? selection.activeIndex : empty };
}
export function moveCard(selection: Selection, index: number, direction: -1 | 1): Selection {
  const target = index + direction;
  if (target < 0 || target >= selection.slots.length) return selection;
  const slots = [...selection.slots];
  [slots[index], slots[target]] = [slots[target]!, slots[index]!];
  return { slots, activeIndex: target };
}
