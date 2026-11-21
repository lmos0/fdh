import { randomBytes, randomInt } from "node:crypto";
import type { ClientCommand, CommandSuccess, ServerEvent } from "../../shared/protocol";
import { MAX_PLAYERS } from "./cards";
import type { Logger } from "../../shared/logging";
import { logger as defaultLogger } from "./logger";
import { requireRule, RuleError } from "./errors";
import {
  advanceRound, handleDepartures, initialGame, isPaused, judgeRound, restartGame, startGame,
  submitCards, syncClocks, expirePhase, RESULT_DURATION_MS,
} from "./game";
import { projectSnapshot } from "./projections";
import { addTestBots, runDueBotAction, syncBotAction } from "./bots";
import type { CachedRequest, Catalog, Effects, GameNotice, GameRoom, Player, Session } from "./types";

export const RECONNECT_GRACE_MS = 60_000;
const EMPTY_ROOM_MS = 5 * 60_000;
const FINISHED_ROOM_MS = 15 * 60_000;
const REQUEST_TTL_MS = 2 * 60_000;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function createRoomService(catalog: Catalog, options: {
  now?: () => number; maxRooms?: number; logger?: Logger; botTestModeEnabled?: boolean;
} = {}) {
  const now = options.now ?? Date.now;
  const logger = options.logger ?? defaultLogger;
  const rooms = new Map<string, GameRoom>();
  const sessions = new Map<string, Session>();
  const bindings = new Map<string, string>();
  const connectionRequests = new Map<string, Map<string, CachedRequest>>();
  const replacedConnections = new Set<string>();
  const maxRooms = options.maxRooms ?? 50;
  const botTestModeEnabled = options.botTestModeEnabled === true;
  const effects = (): Effects => ({ deliveries: [], closeConnections: [] });

  function stateSummary(room: GameRoom) {
    return { phase: room.game.phase, roundId: room.game.round?.id, paused: isPaused(room) };
  }

  function logTransition(room: GameRoom, previous: ReturnType<typeof stateSummary> | undefined) {
    const context = {
      roomCode: room.code, version: room.version, phase: room.game.phase,
      roundId: room.game.round?.id, playerCount: room.players.size,
    };
    if (previous && previous.phase !== room.game.phase) {
      logger.info("game.phase_changed", { ...context, previousPhase: previous.phase });
    }
    const round = room.game.round;
    if (round && round.id !== previous?.roundId) {
      logger.info("round.started", { ...context, roundNumber: round.number,
        judgePlayerId: round.judgePlayerId, pick: round.pick, draw: round.draw });
    }
    if (previous && room.game.phase !== "finished" && previous.paused !== isPaused(room)) {
      logger.info(isPaused(room) ? "game.paused" : "game.resumed", { ...context,
        paused: isPaused(room), connectedPlayers: [...room.players.values()].filter(p => p.disconnectedAt === null).length });
    }
    if (room.game.phase === "finished" && previous?.phase !== "finished") {
      logger.info("game.finished", { ...context, winnerPlayerId: room.game.winnerPlayerId,
        reason: room.game.finishReason, lifetimeMs: now() - room.createdAt });
    }
  }

  function sessionForConnection(connectionId: string): Session | undefined {
    const token = bindings.get(connectionId);
    const session = token ? sessions.get(token) : undefined;
    return session?.connectionId === connectionId ? session : undefined;
  }

  function sessionForPlayer(player: Player): Session | undefined {
    return player.sessionToken ? sessions.get(player.sessionToken) : undefined;
  }

  function cacheFor(connectionId: string): Map<string, CachedRequest> {
    const session = sessionForConnection(connectionId);
    if (session) return session.requests;
    let requests = connectionRequests.get(connectionId);
    if (!requests) {
      requests = new Map();
      connectionRequests.set(connectionId, requests);
    }
    return requests;
  }

  function queueSnapshots(room: GameRoom, output: Effects): void {
    for (const player of room.players.values()) {
      const connectionId = sessionForPlayer(player)?.connectionId;
      if (connectionId) output.deliveries.push({ connectionId, event: {
        type: "state.snapshot", roomCode: room.code, version: room.version,
        payload: projectSnapshot(room, player.id, catalog, now()),
      } });
    }
  }

  function queueNotices(room: GameRoom, notices: GameNotice[], output: Effects): void {
    for (const notice of notices) {
      if (notice.type === "round.result") {
        logger.info("round.completed", { roomCode: room.code, version: room.version,
          roundId: notice.payload.roundId, winnerPlayerId: notice.payload.winnerPlayerId });
      } else {
        logger.info("round.cancelled", { roomCode: room.code, version: room.version,
          roundId: notice.payload.roundId, reason: notice.payload.reason });
      }
      for (const player of room.players.values()) {
        const connectionId = sessionForPlayer(player)?.connectionId;
        if (connectionId) output.deliveries.push({ connectionId, event: {
          ...notice, roomCode: room.code, version: room.version,
        } });
      }
    }
  }

  function touch(room: GameRoom, timestamp: number): void {
    room.version++;
    room.updatedAt = timestamp;
    const anyConnected = [...room.players.values()].some(p => !p.isBot && p.disconnectedAt === null);
    room.emptySince = anyConnected ? null : (room.emptySince ?? timestamp);
    syncClocks(room, timestamp);
    syncBotAction(room, timestamp);
  }

  function processDue(room: GameRoom, timestamp: number, output: Effects): void {
    const previous = stateSummary(room);
    let notices = expirePhase(room, catalog, timestamp);
    const round = room.game.round;
    if (room.game.phase === "round_result" && !isPaused(room) && round?.nextRoundAt != null && timestamp >= round.nextRoundAt) {
      advanceRound(room, catalog, timestamp);
      notices = [];
    }
    if (notices === null) return;
    touch(room, timestamp);
    logTransition(room, previous);
    queueNotices(room, notices, output);
    queueSnapshots(room, output);
  }

  function addPlayer(room: GameRoom, connectionId: string, nickname: string, timestamp: number): Session {
    requireRule(![...room.players.values()].some(p => p.nickname.toLocaleLowerCase("pt-BR") === nickname.toLocaleLowerCase("pt-BR")), "NICKNAME_TAKEN");
    const token = randomBytes(32).toString("hex");
    const player: Player = {
      id: crypto.randomUUID(), nickname, score: 0, hand: [], joinedAt: timestamp,
      disconnectedAt: null, sessionToken: token, isBot: false,
    };
    const session: Session = {
      token, roomCode: room.code, playerId: player.id, connectionId, requests: cacheFor(connectionId),
    };
    room.players.set(player.id, player);
    room.playerOrder.push(player.id);
    sessions.set(token, session);
    bindings.set(connectionId, token);
    connectionRequests.delete(connectionId);
    return session;
  }

  function member(connectionId: string): { session: Session; room: GameRoom; player: Player } {
    const session = sessionForConnection(connectionId);
    requireRule(session, "SESSION_REQUIRED");
    const room = rooms.get(session.roomCode);
    requireRule(room, "ROOM_NOT_FOUND");
    const player = room.players.get(session.playerId);
    requireRule(player, "NOT_IN_ROOM");
    return { session, room, player };
  }

  function removePlayers(room: GameRoom, playerIds: string[], timestamp: number, reason: "left" | "reconnect_timeout"): GameNotice[] {
    const previousHostPlayerId = room.hostPlayerId;
    const removeAll = room.mode === "test" && ![...room.players.values()]
      .some(player => !player.isBot && !playerIds.includes(player.id));
    for (const id of removeAll ? [...room.players.keys()] : playerIds) {
      const player = room.players.get(id);
      if (!player) continue;
      // A carta enviada pertence à rodada; apenas as cartas ainda na mão são descartadas aqui.
      room.game.responseDeck.discardPile.push(...player.hand);
      const session = sessionForPlayer(player);
      if (session?.connectionId) {
        bindings.delete(session.connectionId);
        connectionRequests.set(session.connectionId, session.requests);
      }
      if (player.sessionToken) sessions.delete(player.sessionToken);
      room.players.delete(id);
      logger.info("player.removed", { roomCode: room.code, playerId: id, reason, playerCount: room.players.size, isBot: player.isBot });
    }
    if (room.game.phase === "lobby") {
      room.playerOrder = room.playerOrder.filter(id => room.players.has(id));
    }
    if (!room.players.has(room.hostPlayerId)) {
      const remaining = [...room.players.values()];
      room.hostPlayerId = (remaining.find(p => p.disconnectedAt === null) ?? remaining[0])?.id ?? "";
    }
    if (room.hostPlayerId && previousHostPlayerId !== room.hostPlayerId) {
      logger.info("room.host_changed", { roomCode: room.code, previousHostPlayerId, hostPlayerId: room.hostPlayerId });
    }
    const notices = handleDepartures(room, timestamp, catalog);
    if (!room.players.size) {
      rooms.delete(room.code);
      logger.info("room.removed", { roomCode: room.code, reason: "empty", activeRooms: rooms.size,
        lifetimeMs: timestamp - room.createdAt });
    }
    return notices;
  }

  function closeRoom(room: GameRoom, reason: string, output: Effects): void {
    for (const player of room.players.values()) {
      const session = sessionForPlayer(player);
      if (session?.connectionId) {
        output.deliveries.push({ connectionId: session.connectionId, event: {
          type: "room.closed", payload: { reason },
        } });
        bindings.delete(session.connectionId);
      }
      if (player.sessionToken) sessions.delete(player.sessionToken);
    }
    rooms.delete(room.code);
    logger.info("room.removed", { roomCode: room.code, reason, playerCount: room.players.size,
      activeRooms: rooms.size, lifetimeMs: now() - room.createdAt });
  }

  function execute(connectionId: string, command: ClientCommand): Effects {
    const output = effects();
    const timestamp = now();
    const startedAt = performance.now();
    const activeSession = sessionForConnection(connectionId);
    const roomCode = activeSession?.roomCode ?? ("code" in command.payload ? command.payload.code : undefined);
    const targetRoom = roomCode ? rooms.get(roomCode) : undefined;
    // A manutenção é apenas um despertador: comandos no limite também respeitam o relógio.
    if (targetRoom) processDue(targetRoom, timestamp, output);
    const previous = targetRoom ? stateSummary(targetRoom) : undefined;
    const context = { connectionId, requestId: command.requestId, command: command.type,
      roomCode, playerId: activeSession?.playerId };
    logger.debug("command.received", context);
    const requestCache = cacheFor(connectionId);
    for (const [id, entry] of requestCache) {
      if (timestamp - entry.createdAt >= REQUEST_TTL_MS) requestCache.delete(id);
    }
    const fingerprint = JSON.stringify([command.type, command.payload]);
    const cached = requestCache.get(command.requestId);
    if (cached && cached.fingerprint === fingerprint && !replacedConnections.has(connectionId)) {
      logger.debug("command.replayed", { ...context, messageType: cached.response.type });
      output.deliveries.push({ connectionId, event: cached.response });
      const session = sessionForConnection(connectionId);
      const room = session ? rooms.get(session.roomCode) : undefined;
      if (room && session) output.deliveries.push({ connectionId, event: {
        type: "state.snapshot", roomCode: room.code, version: room.version,
        payload: projectSnapshot(room, session.playerId, catalog, timestamp),
      } });
      return output;
    }

    let response: ServerEvent;
    try {
      requireRule(!replacedConnections.has(connectionId), "CONNECTION_REPLACED");
      requireRule(!cached, "REQUEST_ID_REUSED");
      let changedRoom: GameRoom | undefined;
      let notices: GameNotice[] = [];
      const success: CommandSuccess = { command: command.type };
      switch (command.type) {
        case "room.create": {
          requireRule(!sessionForConnection(connectionId), "ALREADY_IN_ROOM");
          requireRule(command.payload.mode !== "test" || botTestModeEnabled, "FEATURE_DISABLED");
          requireRule(rooms.size < maxRooms, "SERVER_FULL");
          let code: string;
          do {
            code = Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
          } while (rooms.has(code));
          const room: GameRoom = {
            code, hostPlayerId: "", players: new Map(), playerOrder: [],
            mode: command.payload.mode ?? "private", pendingBotAction: null,
            settings: { targetScore: command.payload.targetScore ?? 5, phaseTimeLimitSeconds: 60, resultIntervalSeconds: RESULT_DURATION_MS / 1_000 },
            game: initialGame(), version: 0, createdAt: timestamp, updatedAt: timestamp, emptySince: null,
          };
          const session = addPlayer(room, connectionId, command.payload.nickname, timestamp);
          room.hostPlayerId = session.playerId;
          if (room.mode === "test") addTestBots(room, timestamp);
          rooms.set(code, room);
          success.session = { roomCode: code, playerId: session.playerId, token: session.token };
          changedRoom = room;
          logger.info("room.created", { connectionId, requestId: command.requestId, roomCode: code,
            playerId: session.playerId, targetScore: room.settings.targetScore, activeRooms: rooms.size, maxRooms,
            roomMode: room.mode });
          break;
        }
        case "room.join": {
          requireRule(!sessionForConnection(connectionId), "ALREADY_IN_ROOM");
          const room = rooms.get(command.payload.code);
          requireRule(room, "ROOM_NOT_FOUND");
          requireRule(room.mode !== "test", "TEST_ROOM_PRIVATE");
          requireRule(room.game.phase === "lobby", "GAME_ALREADY_STARTED");
          requireRule(room.players.size < MAX_PLAYERS, "ROOM_FULL");
          const session = addPlayer(room, connectionId, command.payload.nickname, timestamp);
          success.session = { roomCode: room.code, playerId: session.playerId, token: session.token };
          changedRoom = room;
          logger.info("player.joined", { connectionId, requestId: command.requestId, roomCode: room.code,
            playerId: session.playerId, playerCount: room.players.size });
          break;
        }
        case "session.resume": {
          const room = rooms.get(command.payload.code);
          requireRule(room, "ROOM_NOT_FOUND");
          const session = sessions.get(command.payload.token);
          requireRule(session && session.roomCode === room.code, "SESSION_INVALID");
          const current = sessionForConnection(connectionId);
          requireRule(!current || current === session, "ALREADY_IN_ROOM");
          const player = room.players.get(session.playerId);
          requireRule(player, "SESSION_INVALID");
          requireRule(player.disconnectedAt === null || timestamp - player.disconnectedAt < RECONNECT_GRACE_MS, "SESSION_EXPIRED");
          if (session.connectionId && session.connectionId !== connectionId) {
            const oldId = session.connectionId;
            logger.info("session.replaced", { connectionId, previousConnectionId: oldId,
              roomCode: room.code, playerId: session.playerId });
            bindings.delete(oldId);
            connectionRequests.delete(oldId);
            replacedConnections.add(oldId);
            output.deliveries.push({ connectionId: oldId, event: {
              type: "session.replaced", payload: { reason: "Sua sessão foi aberta em outra conexão." },
            } });
            output.closeConnections.push(oldId);
          }
          session.connectionId = connectionId;
          bindings.set(connectionId, session.token);
          connectionRequests.delete(connectionId);
          player.disconnectedAt = null;
          changedRoom = room;
          logger.info("session.resumed", { connectionId, requestId: command.requestId,
            roomCode: room.code, playerId: player.id });
          break;
        }
        default: {
          const { room, player } = member(connectionId);
          changedRoom = room;
          switch (command.type) {
            case "room.leave":
              notices = removePlayers(room, [player.id], timestamp, "left");
              break;
            case "room.configure":
              requireRule(room.hostPlayerId === player.id, "NOT_HOST");
              requireRule(room.game.phase === "lobby", "INVALID_PHASE");
              room.settings.targetScore = command.payload.targetScore;
              if (command.payload.phaseTimeLimitSeconds !== undefined) {
                room.settings.phaseTimeLimitSeconds = command.payload.phaseTimeLimitSeconds;
              }
              if (command.payload.resultIntervalSeconds !== undefined) {
                room.settings.resultIntervalSeconds = command.payload.resultIntervalSeconds;
              }
              logger.info("room.configured", { ...context, targetScore: room.settings.targetScore,
                phaseTimeLimitSeconds: room.settings.phaseTimeLimitSeconds, resultIntervalSeconds: room.settings.resultIntervalSeconds });
              break;
            case "game.start":
              requireRule(room.hostPlayerId === player.id, "NOT_HOST");
               startGame(room, catalog, timestamp);
              logger.info("game.started", { ...context, playerCount: room.players.size,
                targetScore: room.settings.targetScore });
              break;
            case "game.restart":
              requireRule(room.hostPlayerId === player.id, "NOT_HOST");
              restartGame(room, catalog, timestamp, command.payload.toLobby === true);
              logger.info("game.restarted", { ...context, playerCount: room.players.size,
                targetScore: room.settings.targetScore, phase: room.game.phase });
              break;
            case "game.pause":
              requireRule(room.game.phase !== "lobby" && room.game.phase !== "finished", "INVALID_PHASE");
              requireRule(room.game.round?.id === command.payload.roundId, "STALE_ROUND");
              room.game.collectivelyPaused = command.payload.paused;
              logger.info("game.collective_pause_changed", { ...context, collectivelyPaused: room.game.collectivelyPaused });
              break;
            case "round.advance":
              requireRule(room.hostPlayerId === player.id, "NOT_HOST");
              requireRule(room.game.round?.id === command.payload.roundId, "STALE_ROUND");
              requireRule(room.game.phase === "round_result", "INVALID_PHASE");
              requireRule(!isPaused(room), "GAME_PAUSED");
              advanceRound(room, catalog, timestamp);
              break;
            case "round.submit":
              submitCards(room, player, command.payload.roundId, command.payload.cardIds, timestamp);
              break;
            case "round.judge":
              notices = [judgeRound(room, player, command.payload.roundId, command.payload.optionId, catalog, timestamp)];
              break;
          }
        }
      }
      if (changedRoom) {
        touch(changedRoom, timestamp);
        success.appliedVersion = changedRoom.version;
        logTransition(changedRoom, previous);
      }
      response = { type: "command.ok", requestId: command.requestId, payload: success };
      output.deliveries.push({ connectionId, event: response });
      logger.debug("command.accepted", { ...context, roomCode: changedRoom?.code ?? roomCode,
        playerId: sessionForConnection(connectionId)?.playerId ?? context.playerId,
        version: success.appliedVersion, phase: changedRoom?.game.phase,
        roundId: changedRoom?.game.round?.id,
        receivedCount: changedRoom?.game.round?.submissions.size,
        expectedCount: changedRoom?.game.round?.respondentPlayerIds.length,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100 });
      if (changedRoom) {
        queueNotices(changedRoom, notices, output);
        queueSnapshots(changedRoom, output);
      }
    } catch (error) {
      if (error instanceof RuleError) logger.warn("command.rejected", { ...context, errorCode: error.code,
        phase: targetRoom?.game.phase, roundId: targetRoom?.game.round?.id });
      else logger.error("command.failed", { ...context, errorCode: "INTERNAL_ERROR" }, error);
      response = { type: "command.error", requestId: command.requestId, payload: {
        code: error instanceof RuleError ? error.code : "INTERNAL_ERROR",
        message: error instanceof RuleError ? error.code : "Não foi possível concluir a ação.",
      } };
      output.deliveries.push({ connectionId, event: response });
    }
    // Não sobrescrever a confirmação original caso o ID seja reutilizado incorretamente.
    if (!cached) {
      const cache = cacheFor(connectionId);
      cache.set(command.requestId, { fingerprint, response, createdAt: timestamp });
      while (cache.size > 50) cache.delete(cache.keys().next().value!);
    }
    return output;
  }

  function disconnect(connectionId: string): Effects {
    const output = effects();
    const session = sessionForConnection(connectionId);
    bindings.delete(connectionId);
    connectionRequests.delete(connectionId);
    replacedConnections.delete(connectionId);
    if (!session) {
      logger.debug("session.disconnect_ignored", { connectionId, reason: "no_current_binding" });
      return output;
    }
    session.connectionId = null;
    const room = rooms.get(session.roomCode);
    const player = room?.players.get(session.playerId);
    if (!room || !player) return output;
    const timestamp = now();
    processDue(room, timestamp, output);
    const previous = stateSummary(room);
    player.disconnectedAt = timestamp;
    touch(room, timestamp);
    logger.info("player.disconnected", { connectionId, roomCode: room.code, playerId: player.id,
      phase: room.game.phase, roundId: room.game.round?.id });
    logTransition(room, previous);
    queueSnapshots(room, output);
    return output;
  }

  function maintain(): Effects {
    const output = effects();
    const timestamp = now();
    for (const room of rooms.values()) {
      if (room.game.finishedAt !== null && timestamp - room.game.finishedAt >= FINISHED_ROOM_MS) {
        closeRoom(room, "O prazo de exibição da partida terminou.", output);
        continue;
      }
      if (room.emptySince !== null && timestamp - room.emptySince >= EMPTY_ROOM_MS) {
        closeRoom(room, "A sala foi removida por abandono.", output);
        continue;
      }
      const expiredIds = [...room.players.values()]
        .filter(p => p.disconnectedAt !== null && timestamp - p.disconnectedAt >= RECONNECT_GRACE_MS)
        .map(p => p.id);
      if (expiredIds.length) {
        const previous = stateSummary(room);
        const notices = removePlayers(room, expiredIds, timestamp, "reconnect_timeout");
        touch(room, timestamp);
        logger.info("room.sessions_expired", { roomCode: room.code, removedCount: expiredIds.length,
          playerCount: room.players.size, version: room.version });
        logTransition(room, previous);
        queueNotices(room, notices, output);
        queueSnapshots(room, output);
      }
      if (!rooms.has(room.code)) continue;
      processDue(room, timestamp, output);
      const previous = stateSummary(room);
      const botAction = runDueBotAction(room, catalog, timestamp);
      if (botAction) {
        touch(room, timestamp);
        logger.debug("bot.action_applied", { roomCode: room.code, roomMode: room.mode, isBot: true,
          playerId: botAction.playerId, command: botAction.command, roundId: room.game.round?.id,
          phase: room.game.phase, version: room.version });
        logTransition(room, previous);
        queueNotices(room, botAction.notices, output);
        queueSnapshots(room, output);
      }
    }
    return output;
  }

  return { execute, disconnect, maintain };
}

export type RoomService = ReturnType<typeof createRoomService>;
