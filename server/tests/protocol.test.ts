import { describe, expect, test } from "bun:test";
import { createCatalog } from "../src/cards";
import { RuleError } from "../src/errors";
import { parseMessage } from "../src/protocol";

describe("validação do protocolo", () => {
  test("aceita modo de teste explícito sem permitir bots ou configurações arbitrárias no payload", () => {
    for (const mode of ["private", "test"] as const) {
      expect(parseMessage(JSON.stringify({ type: "room.create", requestId: "create", payload: { nickname: "Teste", mode } })).payload)
        .toEqual({ nickname: "Teste", mode });
    }
    for (const payload of [{ nickname: "Teste", mode: "admin" }, { nickname: "Teste", mode: true },
      { nickname: "Teste", mode: null }, { nickname: "Teste", mode: "test", bots: 50 },
      { nickname: "Teste", mode: "test", isBot: true }]) {
      expect(() => parseMessage(JSON.stringify({ type: "room.create", requestId: "invalid_mode", payload }))).toThrow(RuleError);
    }
  });

  test("exige lista de 1 a 3 cartas distintas e recusa o contrato antigo", () => {
    for (const payload of [
      { roundId: "round", cardIds: [] },
      { roundId: "round", cardIds: ["a", "b", "c", "d"] },
      { roundId: "round", cardIds: ["a", "a"] },
      { roundId: "round", cardIds: ["a", 2] },
      { roundId: "round", cardIds: "a" },
      { roundId: "round", cardId: "a" },
    ]) {
      expect(() => parseMessage(JSON.stringify({ type: "round.submit", requestId: "invalid_cards", payload }))).toThrow(RuleError);
    }
    const command = parseMessage(JSON.stringify({ type: "round.submit", requestId: "valid_cards", payload: { roundId: "round", cardIds: ["b", "a", "c"] } }));
    expect(command.payload).toEqual({ roundId: "round", cardIds: ["b", "a", "c"] });
  });

  test("rejeita JSON quebrado, mensagens desconhecidas e propriedades extras", () => {
    for (const raw of ["{", "null", "[]", "42", JSON.stringify({ type: "constructor", payload: {}, requestId: "x" }),
      JSON.stringify({ type: "game.start", payload: { playerId: "forged" }, requestId: "x" }),
      JSON.stringify({ type: "game.start", payload: {}, requestId: "x", playerId: "forged" }),
      JSON.stringify({ type: "connection.pong", payload: { nonce: "n1" }, requestId: "unexpected" })]) {
      expect(() => parseMessage(raw)).toThrow(RuleError);
    }
  });

  test("normaliza apelido e código", () => {
    const command = parseMessage(JSON.stringify({ type: "room.join", requestId: "valid", payload: { code: "abc234", nickname: "  Pessoa  " } }));
    expect(command.payload).toEqual({ code: "ABC234", nickname: "Pessoa" });
  });

  test("rejeita apelido invisível e pontuação fora do intervalo e preserva requestId", () => {
    for (const payload of [{ nickname: "A" }, { nickname: "Jo\u200bao" }, { nickname: "Pessoa", targetScore: 2 }, { nickname: "Pessoa", targetScore: 3.5 }]) {
      try {
        parseMessage(JSON.stringify({ type: "room.create", requestId: "bad_request", payload }));
        throw new Error("Deveria rejeitar");
      } catch (error) {
        expect(error).toBeInstanceOf(RuleError);
        expect((error as RuleError).requestId).toBe("bad_request");
      }
    }
  });

  test("catálogo inválido falha no início, não no meio da partida", () => {
    expect(() => createCatalog([], [])).toThrow();
    expect(() => createCatalog([{ id: "p", text: "Pergunta" }, { id: "p", text: "Outra" }], [])).toThrow();
    expect(() => createCatalog([{ id: "p", text: "" }], [])).toThrow();
  });
});
