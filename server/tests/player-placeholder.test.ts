import { describe, expect, test } from "bun:test";
import { fillPlayerPlaceholders, formatCatalogPrompt, hasPlayerPlaceholder } from "../../shared/prompts";
import type { Catalog } from "../src/types";
import { catalog, table } from "./helpers";

function withPrompts(entries: { id: string; text: string; pick?: number; draw?: number }[]): Catalog {
  const cards = new Map(catalog.cards);
  for (const entry of entries) {
    cards.set(entry.id, { id: entry.id, kind: "prompt", text: entry.text, pick: entry.pick ?? 1, draw: entry.draw ?? 0 });
  }
  return { ...catalog, cards, promptIds: entries.map(entry => entry.id) };
}

describe("placeholder de nome de jogador nas perguntas", () => {
  test("substitui um ou mais {player}, trata caracteres especiais e formata catálogo", () => {
    expect(hasPlayerPlaceholder("Sem placeholder.")).toBe(false);
    expect(hasPlayerPlaceholder("Culpa de {player}.")).toBe(true);
    expect(fillPlayerPlaceholders("Sem placeholder.", ["Ana"])).toBe("Sem placeholder.");
    expect(fillPlayerPlaceholders("Culpa de {player}.", [])).toBe("Culpa de {player}.");
    expect(fillPlayerPlaceholders("{player} e {player} fugiram com _____.", ["Ana", "Bia", "Caio"]))
      .toBe("Ana e Bia fugiram com _____.");
    expect(fillPlayerPlaceholders("{player}, {player} e {player}.", ["Ana", "Bia"]))
      .toBe("Ana, Bia e Ana.");
    expect(fillPlayerPlaceholders("A culpa é de {player}.", ["$$1$&{player}"]))
      .toBe("A culpa é de $$1$&{player}.");
    // Underscores no apelido não podem virar lacunas extras na pergunta.
    const withUnderscores = fillPlayerPlaceholders("Ninguém esperava que {player} fosse parar no Jornal Nacional por _____.", ["jo__ao"]);
    expect(withUnderscores.replaceAll("⁠", "")).toBe("Ninguém esperava que jo__ao fosse parar no Jornal Nacional por _____.");
    expect(withUnderscores.split(/_{2,}/).length - 1).toBe(1);
    expect(fillPlayerPlaceholders("{player}.", ["a_b"])).toBe("a_b.");
    expect(formatCatalogPrompt("Ninguém esperava que {player} fosse parar no Jornal Nacional por _____."))
      .toBe("Ninguém esperava que (nome de um jogador) fosse parar no Jornal Nacional por _____.");
  });

  test("substitui {player} na carta p97 de forma consistente entre clientes, reconexão e histórico", () => {
    const p97 = catalog.cards.get("p97")!;
    expect(p97.text).toContain("{player}");
    const h = table(3, 3, 50, { ...catalog, promptIds: ["p97"] });
    h.command("c0", "game.start", {});

    const names = h.view("c0").room.players.map(player => player.nickname);
    const resolved = h.view("c0").room.round!.prompt.text;
    expect(resolved).not.toContain("{player}");
    expect(names.some(name => resolved === `Ninguém esperava que ${name} fosse parar no Jornal Nacional por _____.`)).toBe(true);

    // Todos os participantes na sala veem exatamente o mesmo nome sorteado.
    for (const connectionId of h.connections) {
      expect(h.view(connectionId).room.round!.prompt.text).toBe(resolved);
    }

    // Reconexão mantém o texto resolvido da rodada sem sortear outro nome.
    h.disconnect("c1");
    h.command("c1_reconnected", "session.resume", {
      code: h.code,
      token: h.credentials.get("c1")!.token,
    });
    expect(h.view("c1_reconnected").room.round!.prompt.text).toBe(resolved);

    // Histórico preserva o nome sorteado daquela rodada.
    const judge = h.judgeConnection();
    const connections = h.connections.map(id => id === "c1" ? "c1_reconnected" : id);
    for (const connectionId of connections) {
      const snapshot = h.view(connectionId);
      if (snapshot.self.playerId === snapshot.room.round!.judgePlayerId) continue;
      h.command(connectionId, "round.submit", {
        roundId: snapshot.room.round!.id,
        cardIds: [snapshot.self.hand[0]!.id],
      });
    }
    const judging = h.view(judge).room.round!;
    expect(judging.prompt.text).toBe(resolved);
    h.command(judge, "round.judge", { roundId: judging.id, optionId: judging.options[0]!.id });

    const historyEntry = h.view(judge).room.history[0]!;
    expect(historyEntry.prompt.id).toBe("p97");
    expect(historyEntry.prompt.text).toBe(resolved);
  });

  test("múltiplos {player} na mesma pergunta escolhem jogadores distintos da sala", () => {
    const custom = withPrompts([{ id: "px1", text: "{player} dedurou {player} por causa de _____." }]);
    const h = table(4, 3, 50, custom);
    h.command("c0", "game.start", {});

    const text = h.view("c0").room.round!.prompt.text;
    const match = /^(.+) dedurou (.+) por causa de _____\.$/.exec(text);
    expect(match).not.toBeNull();
    const [, first, second] = match!;
    const names = new Set(h.view("c0").room.players.map(player => player.nickname));
    expect(names.has(first!)).toBe(true);
    expect(names.has(second!)).toBe(true);
    expect(first).not.toBe(second);
  });
});
