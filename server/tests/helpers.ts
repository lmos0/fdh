import type {
  ClientCommand, CommandPayloads, CommandType, RoomMode, ServerEvent, SessionCredential, Snapshot,
} from "../../shared/protocol";
import { loadCatalog } from "../src/cards";
import { parseMessage } from "../src/protocol";
import { createRoomService } from "../src/rooms";
import type { Catalog, Effects } from "../src/types";
import type { Logger } from "../../shared/logging";

export const catalog = await loadCatalog();
export const singleCatalog: Catalog = {
  ...catalog,
  promptIds: catalog.promptIds.filter(id => {
    const card = catalog.cards.get(id)!;
    return card.kind === "prompt" && card.pick === 1 && card.draw === 0;
  }),
};

export function table(count = 3, targetScore = 3, maxRooms = 50, testCatalog = singleCatalog, logger?: Logger,
  mode: RoomMode = "private", phaseTimeLimitSeconds: number | null = null, resultIntervalSeconds: number | null = 15) {
  let time = 1_000;
  let sequence = 0;
  const service = createRoomService(testCatalog, { now: () => time, maxRooms, logger, botTestModeEnabled: mode === "test" });
  const snapshots = new Map<string, Snapshot>();
  const credentials = new Map<string, SessionCredential>();
  const events: { connectionId: string; event: ServerEvent }[] = [];
  const connections = Array.from({ length: count }, (_, index) => `c${index}`);

  function collect(output: Effects): Effects {
    events.push(...output.deliveries);
    for (const { connectionId, event } of output.deliveries) {
      if (event.type === "state.snapshot") snapshots.set(connectionId, event.payload);
      if (event.type === "command.ok" && event.payload.session) credentials.set(connectionId, event.payload.session);
    }
    return output;
  }
  function command<K extends CommandType>(connectionId: string, type: K, payload: CommandPayloads[K], id?: string): Effects {
    const parsed = parseMessage(JSON.stringify({ type, payload, requestId: id ?? `req_${sequence++}` }));
    return collect(service.execute(connectionId, parsed as ClientCommand));
  }
  function view(connectionId = "c0"): Snapshot {
    const value = snapshots.get(connectionId);
    if (!value) throw new Error(`Sem snapshot de ${connectionId}`);
    return value;
  }
  function tick(milliseconds: number): Effects {
    time += milliseconds;
    return collect(service.maintain());
  }
  function disconnect(connectionId: string): Effects { return collect(service.disconnect(connectionId)); }
  command("c0", "room.create", { nickname: "Pessoa 0", targetScore, mode });
  const code = view().room.code;
  for (let i = 1; i < count; i++) command(`c${i}`, "room.join", { code, nickname: `Pessoa ${i}` });
  // Os testes antigos exercitam regras sem prazo; os testes de relógio optam por um limite.
  command("c0", "room.configure", { targetScore, phaseTimeLimitSeconds, resultIntervalSeconds });

  function judgeConnection(): string {
    const id = view().room.round!.judgePlayerId;
    return [...snapshots].find(([, snapshot]) => snapshot.self.playerId === id)![0];
  }
  function submitAll(): void {
    const judgeId = view().room.round!.judgePlayerId;
    for (const connectionId of connections) {
      const snapshot = view(connectionId);
      if (snapshot.self.playerId === judgeId) continue;
      command(connectionId, "round.submit", {
        roundId: snapshot.room.round!.id,
        cardIds: snapshot.self.hand.slice(0, snapshot.room.round!.prompt.pick).map(card => card.id),
      });
    }
  }
  function elapse(milliseconds: number): void { time += milliseconds; }
  return { service, command, view, credentials, tick, elapse, disconnect, events, connections, judgeConnection, submitAll, code };
}

export function errorCode(output: Effects): string | undefined {
  const reply = output.deliveries.find(delivery => delivery.event.type === "command.error")?.event;
  return reply?.type === "command.error" ? reply.payload.code : undefined;
}
