import { afterEach, describe, expect, test } from "bun:test";
import type { CardCatalogView, CommandPayloads, CommandType, ServerEvent } from "../../shared/protocol";
import { startServer } from "../src/connections";
import { catalog, singleCatalog } from "./helpers";
import { createLogger, type Logger } from "../../shared/logging";

type EventOf<T extends ServerEvent["type"]> = Extract<ServerEvent, { type: T }>;
const applications: ReturnType<typeof startServer>[] = [];
const clients: TestClient[] = [];

class TestClient {
  private inbox: ServerEvent[] = [];
  private listeners = new Set<() => void>();
  constructor(readonly socket: WebSocket) {
    socket.addEventListener("message", event => {
      const message = JSON.parse(event.data as string) as ServerEvent;
      if (message.type === "connection.ping") {
        socket.send(JSON.stringify({ type: "connection.pong", payload: message.payload }));
      } else {
        this.inbox.push(message);
        for (const listener of this.listeners) listener();
      }
    });
  }
  wait<T extends ServerEvent["type"]>(type: T, predicate: (event: EventOf<T>) => boolean = () => true): Promise<EventOf<T>> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.listeners.delete(check);
        reject(new Error(`Timeout aguardando ${type}`));
      }, 2_000);
      const check = () => {
        const index = this.inbox.findIndex(event => event.type === type && predicate(event as EventOf<T>));
        if (index < 0) return;
        const message = this.inbox.splice(index, 1)[0] as EventOf<T>;
        clearTimeout(timer);
        this.listeners.delete(check);
        resolve(message);
      };
      this.listeners.add(check);
      check();
    });
  }
  async command<K extends CommandType>(type: K, payload: CommandPayloads[K]) {
    const requestId = crypto.randomUUID();
    this.socket.send(JSON.stringify({ type, payload, requestId }));
    return this.wait("command.ok", event => event.requestId === requestId);
  }
}

function app(testCatalog = singleCatalog, logger?: Logger, botTestModeEnabled = false) {
  const value = startServer({ catalog: testCatalog, port: 0, hostname: "127.0.0.1", logger, botTestModeEnabled });
  applications.push(value);
  return { ...value, origin: `http://127.0.0.1:${value.server.port}` };
}

async function connect(origin: string): Promise<TestClient> {
  const socket = new WebSocket(origin.replace("http:", "ws:") + "/ws", { headers: { Origin: origin } });
  const client = new TestClient(socket);
  clients.push(client);
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve(), { once: true });
    socket.addEventListener("error", () => reject(new Error("Falha ao conectar")), { once: true });
  });
  return client;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.socket.close();
  for (const application of applications.splice(0)) await application.stop();
});

describe("HTTP e WebSocket reais", () => {
  for (const enabled of [false, true]) {
    test(`configuração pública e proteção WebSocket com bots ${enabled ? "habilitados" : "desabilitados"}`, async () => {
      const { origin } = app(singleCatalog, undefined, enabled);
      const client = await connect(origin);
      const config = await client.wait("server.config");
      expect(config.payload).toEqual({ features: { botTestMode: enabled } });
      client.socket.send(JSON.stringify({ type: "room.create", requestId: "test_room",
        payload: { nickname: "Pessoa", mode: "test" } }));
      if (enabled) {
        const success = await client.wait("command.ok", event => event.requestId === "test_room");
        expect(success.payload.session).toBeDefined();
        const state = await client.wait("state.snapshot");
        expect(state.payload.room.players.filter(player => player.isBot).length).toBe(2);
      } else {
        const failure = await client.wait("command.error", event => event.requestId === "test_room");
        expect(failure.payload.code).toBe("FEATURE_DISABLED");
        await client.command("room.create", { nickname: "Pessoa" });
        const state = await client.wait("state.snapshot");
        expect(state.payload.room.mode).toBe("private");
        expect(state.payload.room.players.length).toBe(1);
      }
    });
  }

  test("logs HTTP/WS correlacionam falhas sem URL, payload ou token", async () => {
    const lines: string[] = [];
    const logger = createLogger({ level: "debug", write: line => lines.push(line) });
    const application = app(singleCatalog, logger);
    const secret = "private-content-never-in-logs";
    await fetch(application.origin + `/health?token=${secret}`);
    await fetch(application.origin + `/unknown-${secret}?token=${secret}`);
    const client = await connect(application.origin);
    client.socket.send(JSON.stringify({ type: "room.create", requestId: "safe_request", payload: { nickname: "A", token: secret } }));
    await client.wait("command.error");
    const created = await client.command("room.create", { nickname: "PrivateNickname" });
    await application.stop();
    const applicationIndex = applications.findIndex(item => item.server === application.server);
    if (applicationIndex >= 0) applications.splice(applicationIndex, 1);
    const records = lines.map(line => JSON.parse(line) as Record<string, unknown>);
    for (const event of ["server.started", "http.response", "connection.opened", "connection.message_rejected",
      "room.created", "server.stopping", "server.stopped"]) expect(records.some(record => record.event === event)).toBe(true);
    expect(records.some(record => record.route === "/health")).toBe(false);
    expect(records.find(record => record.event === "connection.message_rejected")!.requestId).toBe("safe_request");
    const text = lines.join("\n");
    expect(text).not.toContain(secret);
    expect(text).not.toContain("PrivateNickname");
    expect(text).not.toContain(created.payload.session!.token);
  });

  test("catálogo HTTP publica apenas cartas editoriais e respeita métodos", async () => {
    const { origin } = app(catalog);
    const response = await fetch(origin + "/api/cards");
    const data = await response.json() as CardCatalogView;
    expect(data.prompts.length).toBe(90);
    expect(data.responses.length).toBe(459);
    expect(Object.keys(data).sort()).toEqual(["prompts", "responses"]);
    expect(data.prompts.find(card => card.id === "p89")).toMatchObject({ pick: 3, draw: 2 });
    for (const card of data.responses) expect(Object.keys(card).sort()).toEqual(["id", "text"]);
    for (const card of data.prompts) expect(Object.keys(card).sort()).toEqual(["draw", "id", "pick", "text"]);
    expect(response.headers.get("cache-control")).toBe("public, max-age=60");
    const head = await fetch(origin + "/api/cards", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await fetch(origin + "/api/cards", { method: "POST" })).status).toBe(405);
  });

  test("health check, arquivos privados e origem inválida", async () => {
    const { origin } = app();
    const health = await fetch(origin + "/health");
    expect(await health.json()).toEqual({ status: "ok" });
    expect(health.headers.get("x-content-type-options")).toBe("nosniff");
    for (const path of ["/server/cards/responses.json", "/src/index.ts", "/.env", "/assets/%2e%2e/server/cards/prompts.json"]) {
      expect((await fetch(origin + path)).status).toBe(404);
    }
    expect((await fetch(origin + "/ws", { headers: { Origin: "https://evil.example" } })).status).toBe(403);
    expect((await fetch(origin + "/ws", { headers: { Origin: origin } })).status).toBe(426);
  });

  test("três sockets jogam uma rodada e recebem apenas suas mãos", async () => {
    const { origin } = app();
    const players = await Promise.all([connect(origin), connect(origin), connect(origin)]);
    const created = await players[0]!.command("room.create", { nickname: "Ana" });
    const code = created.payload.session!.roomCode;
    await players[1]!.command("room.join", { code, nickname: "Beto" });
    await players[2]!.command("room.join", { code, nickname: "Caio" });
    for (const player of players) await player.wait("state.snapshot", event => event.payload.room.players.length === 3);
    await players[0]!.command("game.start", {});
    const snapshots = await Promise.all(players.map(player => player.wait("state.snapshot", event => event.payload.room.phase === "submitting")));
    const allIds = snapshots.flatMap(event => event.payload.self.hand.map(card => card.id));
    expect(allIds.length).toBe(21);
    expect(new Set(allIds).size).toBe(21);
    const round = snapshots[0]!.payload.room.round!;
    const judgeIndex = snapshots.findIndex(event => event.payload.self.playerId === round.judgePlayerId);
    await Promise.all(players.map((player, index) => {
      if (index === judgeIndex) return Promise.resolve();
      return player.command("round.submit", { roundId: round.id, cardIds: [snapshots[index]!.payload.self.hand[0]!.id] });
    }));
    const judgment = await players[judgeIndex]!.wait("state.snapshot", event => event.payload.room.phase === "judging");
    expect(judgment.payload.room.round!.options.length).toBe(2);
    await players[judgeIndex]!.command("round.judge", { roundId: round.id, optionId: judgment.payload.room.round!.options[0]!.id });
    for (const player of players) {
      const result = await player.wait("state.snapshot", event => event.payload.room.phase === "round_result");
      expect(result.payload.room.players.reduce((total, item) => total + item.score, 0)).toBe(1);
      expect(result.payload.room.round!.result).not.toBeNull();
    }
  });

  test("reconexão substitui socket e preserva participante", async () => {
    const { origin } = app();
    const first = await connect(origin);
    const created = await first.command("room.create", { nickname: "Ana" });
    const credential = created.payload.session!;
    const next = await connect(origin);
    await next.command("session.resume", { code: credential.roomCode, token: credential.token });
    await first.wait("session.replaced");
    const state = await next.wait("state.snapshot");
    expect(state.payload.self.playerId).toBe(credential.playerId);
    expect(state.payload.room.players.length).toBe(1);
    expect(state.payload.room.players[0]!.connected).toBe(true);
  });

  test("mensagem inválida retorna erro correlacionado sem derrubar socket", async () => {
    const { origin } = app();
    const client = await connect(origin);
    client.socket.send(JSON.stringify({ type: "room.create", requestId: "invalid", payload: { nickname: "A" } }));
    const error = await client.wait("command.error");
    expect(error.requestId).toBe("invalid");
    expect(error.payload.code).toBe("INVALID_NICKNAME");
    const created = await client.command("room.create", { nickname: "Ana" });
    expect(created.payload.session).toBeDefined();
  });
});
