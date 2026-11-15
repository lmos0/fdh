import { describe, expect, test } from "bun:test";
import { createLogger, logLevel, type LogFields } from "../../shared/logging";
import { RESULT_DURATION_MS } from "../src/game";
import { RECONNECT_GRACE_MS } from "../src/rooms";
import { singleCatalog, table } from "./helpers";

function capture(level: "debug" | "info" | "warn" | "error" | "silent" = "debug") {
  const lines: string[] = [];
  const logger = createLogger({ level, instanceId: "test-instance", now: () => 0, write: line => lines.push(line) });
  return { lines, logger, records: () => lines.map(line => JSON.parse(line) as Record<string, unknown>) };
}

describe("logs estruturados", () => {
  test("cada registro é JSON com timestamp, nível, evento e correlação", () => {
    const output = capture();
    output.logger.info("room.created", { connectionId: "connection", requestId: "request", roomCode: "ABC234" });
    expect(output.records()).toEqual([{
      timestamp: "1970-01-01T00:00:00.000Z", level: "info", scope: "server", instanceId: "test-instance",
      event: "room.created", connectionId: "connection", requestId: "request", roomCode: "ABC234",
    }]);
  });

  test("respeita níveis, modo silencioso e valores inválidos", () => {
    for (const [level, count] of [["debug", 4], ["info", 3], ["warn", 2], ["error", 1], ["silent", 0]] as const) {
      const output = capture(level);
      output.logger.debug("debug.event");
      output.logger.info("info.event");
      output.logger.warn("warn.event");
      output.logger.error("error.event");
      expect(output.lines.length).toBe(count);
    }
    expect(logLevel("verbose")).toBe("info");
    expect(logLevel("constructor", "warn")).toBe("warn");
    expect(logLevel(undefined, "silent")).toBe("silent");
  });

  test("descarta campos desconhecidos e objetos privados, inclusive via cast", () => {
    const output = capture();
    output.logger.debug("test.safe_fields", {
      requestId: "safe", token: "secret-token", nickname: "secret-name", hand: ["secret-card"],
      payload: { token: "secret-payload" }, roomCode: { token: "nested-secret" },
      version: Number.NaN, message: "private-error-message", level: "spoofed",
    } as unknown as LogFields);
    const serialized = output.lines.join("\n");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("private-error-message");
    expect(output.records()[0]).not.toHaveProperty("roomCode");
    expect(output.records()[0]).not.toHaveProperty("version");
    expect(output.records()[0]!.level).toBe("debug");
  });

  test("erro interno registra frames, mas não mensagem, cause ou payload", () => {
    const output = capture();
    const error = new Error("token=secret\n    at injected-private-content", { cause: "secret-cause" });
    error.stack = `Error: ${error.message}\n    at execute (/server/rooms.ts:10:2)\n    at message (/server/connections.ts:12:3)`;
    output.logger.error("command.failed", { requestId: "safe" }, error);
    const record = output.records()[0]!;
    expect(record.errorName).toBe("Error");
    expect(record.errorFrames).toContain("rooms.ts:10:2");
    expect(output.lines[0]).not.toContain("secret");
    expect(output.lines[0]).not.toContain("injected-private-content");
  });

  test("limita strings e escapa quebras de linha", () => {
    const output = capture();
    output.logger.warn("test.boundaries", { reason: "x".repeat(500), requestId: "hello\nworld" });
    expect(String(output.records()[0]!.reason).length).toBe(160);
    expect(output.lines[0]!.split("\n").length).toBe(1);
  });

  test("falha ao escrever não interrompe execução", () => {
    const logger = createLogger({ write: () => { throw new Error("saída indisponível"); } });
    expect(() => logger.info("test.write_failure")).not.toThrow();
  });

  test("registra ciclo de partida e replay sem tokens, apelidos ou conteúdo das cartas", () => {
    const output = capture();
    const h = table(3, 3, 50, singleCatalog, output.logger);
    h.command("c0", "game.start", {});
    h.submitAll();
    const roundId = h.view().room.round!.id;
    const verdict = { roundId, optionId: h.view().room.round!.options[0]!.id };
    h.command(h.judgeConnection(), "round.judge", verdict, "judge_once");
    h.command(h.judgeConnection(), "round.judge", verdict, "judge_once");
    h.tick(RESULT_DURATION_MS);
    h.disconnect("c1");
    h.command("new", "session.resume", { code: h.code, token: h.credentials.get("c1")!.token });
    h.command("new", "game.start", {});
    const names = output.records().map(record => record.event);
    for (const event of ["room.created", "player.joined", "game.started", "game.phase_changed", "round.started",
      "round.completed", "command.replayed", "player.disconnected", "game.paused", "session.resumed",
      "game.resumed", "command.rejected"]) expect(names).toContain(event);
    expect(output.records().filter(record => record.event === "round.completed").length).toBe(1);
    const text = output.lines.join("\n");
    for (const session of h.credentials.values()) expect(text).not.toContain(session.token);
    for (const player of h.view().room.players) expect(text).not.toContain(player.nickname);
    for (const card of singleCatalog.cards.values()) expect(text).not.toContain(card.text);
    expect(text).not.toContain(verdict.optionId);
    expect(text).not.toContain('"cardIds"');
    expect(text).not.toContain('"hand"');
    const command = output.records().find(record => record.event === "command.accepted" && record.requestId === "judge_once");
    expect(command).toMatchObject({ command: "round.judge", roomCode: h.code, roundId });
    expect(command!.durationMs).toBeNumber();
  });

  test("expiração gera logs de cancelamento, transferência e remoção de sala", () => {
    const output = capture();
    const h = table(4, 3, 50, singleCatalog, output.logger);
    h.command("c0", "game.start", {});
    h.disconnect("c0");
    h.tick(RECONNECT_GRACE_MS);
    for (const event of ["player.removed", "room.host_changed", "room.sessions_expired", "round.cancelled"]) {
      expect(output.records().some(record => record.event === event)).toBe(true);
    }
    for (const id of ["c1", "c2", "c3"]) h.disconnect(id);
    h.tick(RECONNECT_GRACE_MS);
    expect(output.records().some(record => record.event === "room.removed" && record.reason === "empty")).toBe(true);
  });
});
