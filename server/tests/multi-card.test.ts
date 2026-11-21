import { describe, expect, test } from "bun:test";
import { createCatalog } from "../src/cards";
import { RESULT_DURATION_MS } from "../src/game";
import type { Catalog } from "../src/types";
import { catalog, errorCode, table } from "./helpers";

function withPrompt(id: string): Catalog {
  return { ...catalog, promptIds: [id] };
}

describe("perguntas e respostas compostas", () => {
  test("catálogo contém 104 perguntas simples, 15 duplas e 2 triplas", () => {
    const prompts = catalog.promptIds.map(id => catalog.cards.get(id)!);
    expect(prompts.length).toBe(121);
    for (const [pick, count] of [[1, 104], [2, 15], [3, 2]]) {
      expect(prompts.filter(card => card.kind === "prompt" && card.pick === pick).length).toBe(count);
    }
    for (const id of ["p89", "p90"]) expect(catalog.cards.get(id)).toMatchObject({ pick: 3, draw: 2 });
  });

  test("PICK 2 preserva ordem e agrupa a combinação sob um ID anônimo", () => {
    const h = table(3, 3, 50, withPrompt("p77"));
    h.command("c0", "game.start", {});
    const respondent = h.connections.find(id => id !== h.judgeConnection())!;
    const before = h.view(respondent);
    const chosen = [before.self.hand[3]!, before.self.hand[0]!];
    h.command(respondent, "round.submit", { roundId: before.room.round!.id, cardIds: chosen.map(card => card.id) });
    expect(h.view(respondent).self.hand.length).toBe(5);
    expect(h.view(respondent).self.submittedResponses).toEqual(chosen);
    expect(h.view().room.round!.options).toEqual([]);
    h.submitAll();
    const options = h.view().room.round!.options;
    const option = options.find(item => item.responses[0] === chosen[0]!.text)!;
    expect(option.responses).toEqual(chosen.map(card => card.text));
    expect(Object.keys(option).sort()).toEqual(["id", "responses"]);
    expect(options.length).toBe(2);
    expect(options.every(item => item.responses.length === 2)).toBe(true);
    const verdict = { roundId: before.room.round!.id, optionId: option.id };
    h.command(h.judgeConnection(), "round.judge", verdict, "verdict");
    h.command(h.judgeConnection(), "round.judge", verdict, "verdict");
    expect(h.view().room.round!.result!.responseTexts).toEqual(chosen.map(card => card.text));
    expect(h.view().room.players.find(player => player.id === before.self.playerId)!.score).toBe(1);
    expect(h.view().room.players.reduce((sum, player) => sum + player.score, 0)).toBe(1);
    h.tick(RESULT_DURATION_MS);
    for (const connection of h.connections) expect(h.view(connection).self.hand.length).toBe(7);
  });

  test("valida toda a combinação antes de alterar a mão", () => {
    const h = table(3, 3, 50, withPrompt("p77"));
    h.command("c0", "game.start", {});
    const respondent = h.connections.find(id => id !== h.judgeConnection())!;
    const before = structuredClone(h.view(respondent));
    const roundId = before.room.round!.id;
    const own = before.self.hand[0]!.id;
    const foreign = h.view(h.judgeConnection()).self.hand[0]!.id;
    expect(errorCode(h.command(respondent, "round.submit", { roundId, cardIds: [own] }))).toBe("INVALID_CARD_COUNT");
    expect(errorCode(h.command(respondent, "round.submit", { roundId, cardIds: before.self.hand.slice(0, 3).map(card => card.id) }))).toBe("INVALID_CARD_COUNT");
    expect(errorCode(h.command(respondent, "round.submit", { roundId, cardIds: [own, foreign] }))).toBe("CARD_NOT_IN_HAND");
    const duplicate = h.service.execute(respondent, {
      type: "round.submit", requestId: "duplicate", payload: { roundId, cardIds: [own, own] },
    });
    expect(errorCode(duplicate)).toBe("DUPLICATE_CARDS");
    expect(h.view(respondent).self).toEqual(before.self);
    expect(h.view().room.round!.receivedCount).toBe(0);
  });

  test("DRAW 2 dá extras só aos respondentes, sem vazar IDs ou autoria no julgamento", () => {
    const h = table(8, 3, 50, withPrompt("p89"));
    h.command("c0", "game.start", {});
    const judge = h.judgeConnection();
    const hands = h.connections.flatMap(id => h.view(id).self.hand.map(card => card.id));
    expect(hands.length).toBe(70);
    expect(new Set(hands).size).toBe(70);
    for (const connection of h.connections) expect(h.view(connection).self.hand.length).toBe(connection === judge ? 7 : 9);
    h.submitAll();
    expect(h.view().room.phase).toBe("judging");
    const options = h.view().room.round!.options;
    expect(options.length).toBe(7);
    for (const option of options) {
      expect(option.responses.length).toBe(3);
      expect(Object.keys(option).sort()).toEqual(["id", "responses"]);
      expect(hands).not.toContain(option.id);
    }
    const publicState = JSON.stringify(h.view(judge).room);
    for (const cardId of hands) expect(publicState).not.toContain(`"${cardId}"`);
  });

  test("reconexão mantém mão, extras e ordem de uma resposta tripla", () => {
    const h = table(3, 3, 50, withPrompt("p90"));
    h.command("c0", "game.start", {});
    const respondent = h.connections.find(id => id !== h.judgeConnection())!;
    const snapshot = h.view(respondent);
    const chosen = [snapshot.self.hand[5]!, snapshot.self.hand[1]!, snapshot.self.hand[7]!];
    h.command(respondent, "round.submit", { roundId: snapshot.room.round!.id, cardIds: chosen.map(card => card.id) });
    const before = structuredClone(h.view(respondent).self);
    h.disconnect(respondent);
    h.tick(10_000);
    h.command("new", "session.resume", { code: h.code, token: h.credentials.get(respondent)!.token });
    expect(h.view("new").self).toEqual(before);
    expect(h.view("new").self.hand.length).toBe(6);
    expect(h.view("new").self.submittedResponses).toEqual(chosen);
    expect(h.view("new").room.paused).toBe(false);
  });

  test("cancelamentos sucessivos não acumulam cartas extras", () => {
    const h = table(8, 3, 50, withPrompt("p89"));
    h.command("c0", "game.start", {});
    for (const leaving of ["c7", "c6", "c5", "c4"]) {
      h.command(leaving, "room.leave", {});
      const current = h.view();
      expect(current.room.phase).toBe("submitting");
      const remaining = h.connections.filter(id => current.room.players.some(player => player.id === h.view(id).self.playerId));
      const handIds = remaining.flatMap(id => h.view(id).self.hand.map(card => card.id));
      expect(new Set(handIds).size).toBe(handIds.length);
      for (const id of remaining) {
        expect(h.view(id).self.hand.length).toBe(h.view(id).self.playerId === current.room.round!.judgePlayerId ? 7 : 9);
      }
    }
  });

  test("recicla o catálogo mínimo de 70 respostas em rodadas triplas", () => {
    const minimum = createCatalog([{ id: "multi", text: "Faça uma combinação.", pick: 3, draw: 2 }],
      catalog.responseIds.slice(0, 70).map(id => ({ id, text: catalog.cards.get(id)!.text })));
    const h = table(8, 20, 50, minimum);
    h.command("c0", "game.start", {});
    for (let iteration = 0; iteration < 12; iteration++) {
      h.submitAll();
      const option = h.view().room.round!.options[0]!;
      h.command(h.judgeConnection(), "round.judge", { roundId: h.view().room.round!.id, optionId: option.id });
      expect(h.view().room.round!.result!.responseTexts.length).toBe(3);
      h.tick(RESULT_DURATION_MS);
      const hands = h.connections.flatMap(id => h.view(id).self.hand.map(card => card.id));
      expect(hands.length).toBe(70);
      expect(new Set(hands).size).toBe(70);
      expect(h.view().room.phase).toBe("submitting");
    }
  });

  test("rejeita metadados inválidos e baralho insuficiente para os extras", () => {
    const responses = catalog.responseIds.slice(0, 70).map(id => ({ id, text: catalog.cards.get(id)!.text }));
    for (const metadata of [{ pick: 0 }, { pick: 4 }, { pick: 1.5 }, { draw: 3 }, { draw: -1 }, { draw: "2" }]) {
      expect(() => createCatalog([{ id: "q", text: "Pergunta", ...metadata }], responses)).toThrow();
    }
    expect(() => createCatalog([{ id: "q", text: "Pergunta", pick: 3, draw: 2 }], responses.slice(0, 69))).toThrow();
    expect(createCatalog([{ id: "q", text: "Pergunta sem lacunas" }], responses).cards.get("q")).toMatchObject({ pick: 1, draw: 0 });
  });
});
