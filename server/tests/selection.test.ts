import { describe, expect, test } from "bun:test";
import { chooseCard, emptySelection, moveCard } from "../../client/src/selection";

describe("edição da combinação antes do envio", () => {
  test("preenche espaços na ordem sem duplicar cartas", () => {
    let state = emptySelection(3);
    for (const id of ["c", "a", "b"]) state = chooseCard(state, id);
    expect(state.slots).toEqual(["c", "a", "b"]);
    expect(state.activeIndex).toBe(2);
  });
  test("troca somente o espaço ativo com a combinação cheia", () => {
    const original = { slots: ["a", "b", "c"], activeIndex: 1 };
    expect(chooseCard(original, "d").slots).toEqual(["a", "d", "c"]);
    expect(original.slots).toEqual(["a", "b", "c"]);
  });
  test("desmarcar preserva os espaços e preencher não desloca a terceira carta", () => {
    const state = chooseCard({ slots: ["a", "b", "c"], activeIndex: 2 }, "b");
    expect(state.slots).toEqual(["a", null, "c"]);
    expect(chooseCard(state, "d").slots).toEqual(["a", "d", "c"]);
  });
  test("mover troca espaços e mantém o foco de edição na carta movida", () => {
    const state = { slots: ["a", "b", "c"], activeIndex: 1 };
    expect(moveCard(state, 1, -1)).toEqual({ slots: ["b", "a", "c"], activeIndex: 0 });
    expect(moveCard(state, 1, 1)).toEqual({ slots: ["a", "c", "b"], activeIndex: 2 });
    expect(moveCard(state, 0, -1)).toBe(state);
    expect(moveCard(state, 2, 1)).toBe(state);
  });
  test("PICK 1 permite substituir ou limpar sem passo extra", () => {
    let state = chooseCard(emptySelection(1), "a");
    state = chooseCard(state, "b");
    expect(state.slots).toEqual(["b"]);
    expect(chooseCard(state, "b").slots).toEqual([null]);
  });
});
