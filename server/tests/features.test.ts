import { describe, expect, test } from "bun:test";
import { readFeatureFlags } from "../src/config";
import { createRoomService } from "../src/rooms";
import { parseMessage } from "../src/protocol";
import { errorCode, singleCatalog } from "./helpers";
import type { ClientCommand, CommandPayloads, CommandType } from "../../shared/protocol";

describe("feature flag do modo com bots", () => {
  for (const value of [undefined, "true", "false"]) {
    test(`lê a variável real do processo (${value ?? "ausente"})`, async () => {
      const env = { ...process.env };
      if (value === undefined) delete env.ENABLE_BOT_TEST_MODE;
      else env.ENABLE_BOT_TEST_MODE = value;
      const modulePath = new URL("../src/config.ts", import.meta.url).pathname;
      // O .env local não pode repor a variável removida deste processo de teste.
      const child = Bun.spawn([process.execPath, "--no-env-file", "--eval",
        `import { readFeatureFlags } from ${JSON.stringify(modulePath)}; console.log(JSON.stringify(readFeatureFlags()));`],
      { env, stdout: "pipe", stderr: "pipe" });
      const output = await new Response(child.stdout).text();
      expect(await child.exited).toBe(0);
      expect(JSON.parse(output)).toEqual({ botTestMode: value === "true" });
    });
  }

  test("habilita somente com true explícito na variável de ambiente", () => {
    expect(readFeatureFlags({})).toEqual({ botTestMode: false });
    for (const value of ["false", "FALSE", "", "0", "1", "yes", "enabled", "tru"]) {
      expect(readFeatureFlags({ ENABLE_BOT_TEST_MODE: value })).toEqual({ botTestMode: false });
    }
    for (const value of ["true", "TRUE", " true "]) {
      expect(readFeatureFlags({ ENABLE_BOT_TEST_MODE: value })).toEqual({ botTestMode: true });
    }
  });

  test("serviço recusa criação de teste por padrão e não ocupa sala ou sessão", () => {
    const service = createRoomService(singleCatalog, { maxRooms: 1 });
    let sequence = 0;
    function command<K extends CommandType>(type: K, payload: CommandPayloads[K]) {
      const parsed = parseMessage(JSON.stringify({ type, payload, requestId: `req_${sequence++}` })) as ClientCommand;
      return service.execute("connection", parsed);
    }
    const rejected = command("room.create", { nickname: "Pessoa", mode: "test" });
    expect(errorCode(rejected)).toBe("FEATURE_DISABLED");
    expect(rejected.deliveries.some(delivery => delivery.event.type === "state.snapshot")).toBe(false);
    const normal = command("room.create", { nickname: "Pessoa" });
    expect(errorCode(normal)).toBeUndefined();
    const state = normal.deliveries.find(delivery => delivery.event.type === "state.snapshot")!.event;
    if (state.type !== "state.snapshot") throw new Error("Snapshot esperado");
    expect(state.payload.room.mode).toBe("private");
    expect(state.payload.room.players.length).toBe(1);
    expect(state.payload.room.players[0]!.isBot).toBe(false);
  });

  test("flag habilitada permite o teste e mantém criação normal sem bots", () => {
    const features = readFeatureFlags({ ENABLE_BOT_TEST_MODE: "true" });
    const service = createRoomService(singleCatalog, { botTestModeEnabled: features.botTestMode });
    for (const mode of ["test", "private"] as const) {
      const output = service.execute(mode, { type: "room.create", requestId: mode,
        payload: { nickname: "Pessoa", mode } });
      expect(errorCode(output)).toBeUndefined();
      const event = output.deliveries.find(delivery => delivery.event.type === "state.snapshot")!.event;
      if (event.type !== "state.snapshot") throw new Error("Snapshot esperado");
      expect(event.payload.room.mode).toBe(mode);
      expect(event.payload.room.players.filter(player => player.isBot).length).toBe(mode === "test" ? 2 : 0);
    }
  });

  test("cliente não consegue alterar a flag por payload ou evento de servidor", () => {
    for (const payload of [{ nickname: "Pessoa", mode: "test", botTestModeEnabled: true },
      { nickname: "Pessoa", mode: "test", features: { botTestMode: true } }]) {
      expect(() => parseMessage(JSON.stringify({ type: "room.create", requestId: "forged", payload }))).toThrow();
    }
    expect(() => parseMessage(JSON.stringify({ type: "server.config", requestId: "forged",
      payload: { features: { botTestMode: true } } }))).toThrow();
  });
});
