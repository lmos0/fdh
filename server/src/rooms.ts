import { randomBytes, randomInt } from "node:crypto";
import type {
  ClientCommand, CommandPayloads, CommandSuccess, CommandType, ServerEvent, SessionCredential,
} from "../../shared/protocol";
import { DEFAULT_TARGET_SCORE, isGameInProgress, MAX_PLAYERS, RECONNECT_GRACE_SECONDS } from "../../shared/protocol";
import type { LogFields, Logger } from "../../shared/logging";
import { elapsedMs, logger as defaultLogger } from "./logger";
import { requireRule, RuleError } from "./errors";
import {
  advanceRound, expirePhase, handleDepartures, hasConnectedHuman, initialGame, isNicknameTaken, isPaused,
  judgeRound, MS_PER_SECOND, requireHost, restartGame, RESULT_DURATION_MS, startGame, submitCards, swapCard, syncClocks,
} from "./game";
import { projectSnapshot } from "./projections";
import { addTestBots, runDueBotAction, syncBotAction } from "./bots";
import type { CachedRequest, Catalog, Effects, GameNotice, GameRoom, Player, Session } from "./types";

export const RECONNECT_GRACE_MS = RECONNECT_GRACE_SECONDS * MS_PER_SECOND;
const EMPTY_ROOM_MS = 5 * 60_000;
const FINISHED_ROOM_MS = 15 * 60_000;
const REQUEST_TTL_MS = 2 * 60_000;
const MAX_CACHED_REQUESTS = 50;
const DEFAULT_MAX_ROOMS = 50;
const DEFAULT_PHASE_TIME_LIMIT_SECONDS = 60;
const ROOM_CODE_LENGTH = 6;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const SESSION_TOKEN_BYTES = 32;
const INTERNAL_ERROR_MESSAGE = "Não foi possível concluir a ação.";

type StateSummary = { phase: GameRoom["game"]["phase"]; roundId: string | undefined; paused: boolean };
interface Membership { session: Session; room: GameRoom; player: Player }
interface CommandContext {
  connectionId: string;
  requestId: string;
  timestamp: number;
  output: Effects;
  success: CommandSuccess;
  log: LogFields;
}
interface CommandOutcome { room?: GameRoom; notices?: GameNotice[] }
type CommandHandler<K extends CommandType> = (payload: CommandPayloads[K], context: CommandContext) => CommandOutcome;
type CommandHandlers = { [K in CommandType]: CommandHandler<K> };
type MemberHandler<K extends CommandType> =
  (payload: CommandPayloads[K], membership: Membership, context: CommandContext) => GameNotice[] | void;

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
  const maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
  const botTestModeEnabled = options.botTestModeEnabled === true;
  const effects = (): Effects => ({ deliveries: [], closeConnections: [] });

  function stateSummary(room: GameRoom): StateSummary {
    return { phase: room.game.phase, roundId: room.game.round?.id, paused: isPaused(room) };
  }

  function logTransition(room: GameRoom, previous: StateSummary | undefined): void {
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
      logger.info(isPaused(room) ? "game.paused" : "game.resumed", { ...context, paused: isPaused(room),
        connectedPlayers: [...room.players.values()].filter(player => player.disconnectedAt === null).length });
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

  function credentialFor(session: Session): SessionCredential {
    return { roomCode: session.roomCode, playerId: session.playerId, token: session.token };
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

  function snapshotEvent(room: GameRoom, playerId: string, timestamp: number): ServerEvent {
    return {
      type: "state.snapshot", roomCode: room.code, version: room.version,
      payload: projectSnapshot(room, playerId, catalog, timestamp),
    };
  }

  function queueSnapshots(room: GameRoom, output: Effects): void {
    for (const player of room.players.values()) {
      const connectionId = sessionForPlayer(player)?.connectionId;
      if (connectionId) output.deliveries.push({ connectionId, event: snapshotEvent(room, player.id, now()) });
    }
  }

  function logNotice(room: GameRoom, notice: GameNotice): void {
    const context = { roomCode: room.code, version: room.version, roundId: notice.payload.roundId };
    switch (notice.type) {
      case "round.result":
        logger.info("round.completed", { ...context, winnerPlayerId: notice.payload.winnerPlayerId });
        return;
      case "round.cancelled":
        logger.info("round.cancelled", { ...context, reason: notice.payload.reason });
        return;
      case "card.swapped":
        return; // Já registrado pelo comando, que também cobre as trocas gratuitas.
      default: {
        const unreachable: never = notice;
        throw new Error(`Aviso não tratado: ${(unreachable as GameNotice).type}`);
      }
    }
  }

  function queueNotices(room: GameRoom, notices: GameNotice[], output: Effects): void {
    for (const notice of notices) {
      logNotice(room, notice);
      for (const player of room.players.values()) {
        const connectionId = sessionForPlayer(player)?.connectionId;
        if (connectionId) output.deliveries.push({ connectionId, event: {
          ...notice, roomCode: room.code, version: room.version,
        } });
      }
    }
  }

  function broadcastChange(room: GameRoom, previous: StateSummary, notices: GameNotice[], output: Effects): void {
    logTransition(room, previous);
    queueNotices(room, notices, output);
    queueSnapshots(room, output);
  }

  function touch(room: GameRoom, timestamp: number): void {
    room.version++;
    room.updatedAt = timestamp;
    room.emptySince = hasConnectedHuman(room) ? null : (room.emptySince ?? timestamp);
    syncClocks(room, timestamp);
    syncBotAction(room, timestamp);
  }

  function resultIntervalElapsed(room: GameRoom, timestamp: number): boolean {
    const nextRoundAt = room.game.round?.nextRoundAt;
    if (room.game.phase !== "round_result" || isPaused(room)) return false;
    return nextRoundAt !== null && nextRoundAt !== undefined && timestamp >= nextRoundAt;
  }

  function processDue(room: GameRoom, timestamp: number, output: Effects): void {
    const previous = stateSummary(room);
    let notices = expirePhase(room, catalog, timestamp);
    if (resultIntervalElapsed(room, timestamp)) {
      advanceRound(room, catalog, timestamp);
      notices = [];
    }
    if (notices === null) return;
    touch(room, timestamp);
    broadcastChange(room, previous, notices, output);
  }

  function addPlayer(room: GameRoom, connectionId: string, nickname: string, timestamp: number): Session {
    requireRule(!isNicknameTaken(room, nickname), "NICKNAME_TAKEN");
    const token = randomBytes(SESSION_TOKEN_BYTES).toString("hex");
    const player: Player = {
      id: crypto.randomUUID(), nickname, score: 0, hand: [], joinedAt: timestamp,
      disconnectedAt: null, sessionToken: token, isBot: false, freeSwapsUsed: 0,
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

  function member(connectionId: string): Membership {
    const session = sessionForConnection(connectionId);
    requireRule(session, "SESSION_REQUIRED");
    const room = rooms.get(session.roomCode);
    requireRule(room, "ROOM_NOT_FOUND");
    const player = room.players.get(session.playerId);
    requireRule(player, "NOT_IN_ROOM");
    return { session, room, player };
  }

  /** Em sala de teste, a saída da última pessoa encerra também os bots. */
  function playersToRemove(room: GameRoom, playerIds: string[]): string[] {
    const humanRemains = [...room.players.values()].some(player => !player.isBot && !playerIds.includes(player.id));
    return room.mode === "test" && !humanRemains ? [...room.players.keys()] : playerIds;
  }

  function detachPlayer(room: GameRoom, player: Player, reason: "left" | "reconnect_timeout"): void {
    // A carta enviada pertence à rodada; apenas as cartas ainda na mão são descartadas aqui.
    room.game.responseDeck.discardPile.push(...player.hand);
    const session = sessionForPlayer(player);
    if (session?.connectionId) {
      bindings.delete(session.connectionId);
      connectionRequests.set(session.connectionId, session.requests);
    }
    if (player.sessionToken) sessions.delete(player.sessionToken);
    room.players.delete(player.id);
    logger.info("player.removed", { roomCode: room.code, playerId: player.id, reason,
      playerCount: room.players.size, isBot: player.isBot });
  }

  function reassignHost(room: GameRoom): void {
    if (room.players.has(room.hostPlayerId)) return;
    const previousHostPlayerId = room.hostPlayerId;
    const remaining = [...room.players.values()];
    room.hostPlayerId = (remaining.find(player => player.disconnectedAt === null) ?? remaining[0])?.id ?? "";
    if (!room.hostPlayerId) return;
    logger.info("room.host_changed", { roomCode: room.code, previousHostPlayerId, hostPlayerId: room.hostPlayerId });
  }

  function removePlayers(room: GameRoom, playerIds: string[], timestamp: number, reason: "left" | "reconnect_timeout"): GameNotice[] {
    for (const id of playersToRemove(room, playerIds)) {
      const player = room.players.get(id);
      if (player) detachPlayer(room, player, reason);
    }
    if (room.game.phase === "lobby") {
      room.playerOrder = room.playerOrder.filter(id => room.players.has(id));
    }
    reassignHost(room);
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

  function generateRoomCode(): string {
    let code: string;
    do {
      code = Array.from({ length: ROOM_CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join("");
    } while (rooms.has(code));
    return code;
  }

  function newRoom(code: string, payload: CommandPayloads["room.create"], timestamp: number): GameRoom {
    return {
      code, hostPlayerId: "", players: new Map(), playerOrder: [],
      mode: payload.mode ?? "private", pendingBotAction: null,
      settings: {
        targetScore: payload.targetScore ?? DEFAULT_TARGET_SCORE,
        phaseTimeLimitSeconds: DEFAULT_PHASE_TIME_LIMIT_SECONDS,
        resultIntervalSeconds: RESULT_DURATION_MS / MS_PER_SECOND,
      },
      game: initialGame(), version: 0, createdAt: timestamp, updatedAt: timestamp, emptySince: null,
    };
  }


  function createRoom(payload: CommandPayloads["room.create"], context: CommandContext): CommandOutcome {
    requireRule(!sessionForConnection(context.connectionId), "ALREADY_IN_ROOM");
    requireRule(payload.mode !== "test" || botTestModeEnabled, "FEATURE_DISABLED");
    requireRule(rooms.size < maxRooms, "SERVER_FULL");
    const room = newRoom(generateRoomCode(), payload, context.timestamp);
    const session = addPlayer(room, context.connectionId, payload.nickname, context.timestamp);
    room.hostPlayerId = session.playerId;
    if (room.mode === "test") addTestBots(room, context.timestamp);
    rooms.set(room.code, room);
    context.success.session = credentialFor(session);
    logger.info("room.created", { connectionId: context.connectionId, requestId: context.requestId,
      roomCode: room.code, playerId: session.playerId, targetScore: room.settings.targetScore,
      activeRooms: rooms.size, maxRooms, roomMode: room.mode });
    return { room };
  }

  function joinRoom(payload: CommandPayloads["room.join"], context: CommandContext): CommandOutcome {
    requireRule(!sessionForConnection(context.connectionId), "ALREADY_IN_ROOM");
    const room = rooms.get(payload.code);
    requireRule(room, "ROOM_NOT_FOUND");
    requireRule(room.mode !== "test", "TEST_ROOM_PRIVATE");
    requireRule(room.game.phase === "lobby", "GAME_ALREADY_STARTED");
    requireRule(room.players.size < MAX_PLAYERS, "ROOM_FULL");
    const session = addPlayer(room, context.connectionId, payload.nickname, context.timestamp);
    context.success.session = credentialFor(session);
    logger.info("player.joined", { connectionId: context.connectionId, requestId: context.requestId,
      roomCode: room.code, playerId: session.playerId, playerCount: room.players.size });
    return { room };
  }

  function canReconnect(player: Player, timestamp: number): boolean {
    return player.disconnectedAt === null || timestamp - player.disconnectedAt < RECONNECT_GRACE_MS;
  }

  function replacePreviousConnection(room: GameRoom, session: Session, context: CommandContext): void {
    const previousId = session.connectionId;
    if (!previousId || previousId === context.connectionId) return;
    logger.info("session.replaced", { connectionId: context.connectionId, previousConnectionId: previousId,
      roomCode: room.code, playerId: session.playerId });
    bindings.delete(previousId);
    connectionRequests.delete(previousId);
    replacedConnections.add(previousId);
    context.output.deliveries.push({ connectionId: previousId, event: {
      type: "session.replaced", payload: { reason: "Sua sessão foi aberta em outra conexão." },
    } });
    context.output.closeConnections.push(previousId);
  }

  function resumeSession(payload: CommandPayloads["session.resume"], context: CommandContext): CommandOutcome {
    const room = rooms.get(payload.code);
    requireRule(room, "ROOM_NOT_FOUND");
    const session = sessions.get(payload.token);
    requireRule(session && session.roomCode === room.code, "SESSION_INVALID");
    const current = sessionForConnection(context.connectionId);
    requireRule(!current || current === session, "ALREADY_IN_ROOM");
    const player = room.players.get(session.playerId);
    requireRule(player, "SESSION_INVALID");
    requireRule(canReconnect(player, context.timestamp), "SESSION_EXPIRED");
    replacePreviousConnection(room, session, context);
    session.connectionId = context.connectionId;
    bindings.set(context.connectionId, session.token);
    connectionRequests.delete(context.connectionId);
    player.disconnectedAt = null;
    logger.info("session.resumed", { connectionId: context.connectionId, requestId: context.requestId,
      roomCode: room.code, playerId: player.id });
    return { room };
  }


  function forMember<K extends CommandType>(handler: MemberHandler<K>): CommandHandler<K> {
    return (payload, context) => {
      const membership = member(context.connectionId);
      return { room: membership.room, notices: handler(payload, membership, context) ?? [] };
    };
  }

  const leaveRoom: MemberHandler<"room.leave"> = (_payload, { room, player }, context) =>
    removePlayers(room, [player.id], context.timestamp, "left");

  const configureRoom: MemberHandler<"room.configure"> = (payload, { room, player }, context) => {
    requireHost(room, player);
    requireRule(room.game.phase === "lobby", "INVALID_PHASE");
    room.settings.targetScore = payload.targetScore;
    // Campos omitidos preservam a configuração; `null` significa "sem limite".
    if (payload.phaseTimeLimitSeconds !== undefined) room.settings.phaseTimeLimitSeconds = payload.phaseTimeLimitSeconds;
    if (payload.resultIntervalSeconds !== undefined) room.settings.resultIntervalSeconds = payload.resultIntervalSeconds;
    logger.info("room.configured", { ...context.log, targetScore: room.settings.targetScore,
      phaseTimeLimitSeconds: room.settings.phaseTimeLimitSeconds, resultIntervalSeconds: room.settings.resultIntervalSeconds });
  };

  const beginGame: MemberHandler<"game.start"> = (_payload, { room, player }, context) => {
    requireHost(room, player);
    startGame(room, catalog, context.timestamp);
    logger.info("game.started", { ...context.log, playerCount: room.players.size, targetScore: room.settings.targetScore });
  };

  const restartRoomGame: MemberHandler<"game.restart"> = (payload, { room, player }, context) => {
    requireHost(room, player);
    restartGame(room, catalog, context.timestamp, payload.toLobby === true);
    logger.info("game.restarted", { ...context.log, playerCount: room.players.size,
      targetScore: room.settings.targetScore, phase: room.game.phase });
  };

  const pauseGame: MemberHandler<"game.pause"> = (payload, { room }, context) => {
    requireRule(isGameInProgress(room.game.phase), "INVALID_PHASE");
    requireRule(room.game.round?.id === payload.roundId, "STALE_ROUND");
    room.game.collectivelyPaused = payload.paused;
    logger.info("game.collective_pause_changed", { ...context.log, collectivelyPaused: room.game.collectivelyPaused });
  };

  const advanceResult: MemberHandler<"round.advance"> = (payload, { room, player }, context) => {
    requireHost(room, player);
    requireRule(room.game.round?.id === payload.roundId, "STALE_ROUND");
    requireRule(room.game.phase === "round_result", "INVALID_PHASE");
    requireRule(!isPaused(room), "GAME_PAUSED");
    advanceRound(room, catalog, context.timestamp);
  };

  const submitResponse: MemberHandler<"round.submit"> = (payload, { room, player }, context) => {
    submitCards(room, player, payload.roundId, payload.cardIds, context.timestamp);
  };

  const swapResponseCard: MemberHandler<"round.swap"> = (payload, { room, player }, context) => {
    const notices = swapCard(room, player, payload.roundId, payload.cardId, payload.cost);
    logger.info("card.swapped", { ...context.log, roundId: payload.roundId, swapCost: payload.cost });
    return notices;
  };

  const judgeResponse: MemberHandler<"round.judge"> = (payload, { room, player }, context) =>
    [judgeRound(room, player, payload.roundId, payload.optionId, catalog, context.timestamp)];

  const commandHandlers: CommandHandlers = {
    "room.create": createRoom,
    "room.join": joinRoom,
    "session.resume": resumeSession,
    "room.leave": forMember(leaveRoom),
    "room.configure": forMember(configureRoom),
    "game.start": forMember(beginGame),
    "game.restart": forMember(restartRoomGame),
    "game.pause": forMember(pauseGame),
    "round.advance": forMember(advanceResult),
    "round.submit": forMember(submitResponse),
    "round.judge": forMember(judgeResponse),
    "round.swap": forMember(swapResponseCard),
  };

  function runHandler<K extends CommandType>(command: { type: K; payload: CommandPayloads[K] }, context: CommandContext): CommandOutcome {
    return commandHandlers[command.type](command.payload, context);
  }


  function pruneExpiredRequests(cache: Map<string, CachedRequest>, timestamp: number): void {
    for (const [id, entry] of cache) {
      if (timestamp - entry.createdAt >= REQUEST_TTL_MS) cache.delete(id);
    }
  }

  function rememberResponse(connectionId: string, requestId: string, entry: CachedRequest): void {
    const cache = cacheFor(connectionId);
    cache.set(requestId, entry);
    while (cache.size > MAX_CACHED_REQUESTS) cache.delete(cache.keys().next().value!);
  }

  function replayResponse(connectionId: string, cached: CachedRequest, context: CommandContext): void {
    logger.debug("command.replayed", { ...context.log, messageType: cached.response.type });
    context.output.deliveries.push({ connectionId, event: cached.response });
    const session = sessionForConnection(connectionId);
    const room = session ? rooms.get(session.roomCode) : undefined;
    if (room && session) context.output.deliveries.push({ connectionId, event: snapshotEvent(room, session.playerId, context.timestamp) });
  }

  function acceptCommand(outcome: CommandOutcome, context: CommandContext, previous: StateSummary | undefined, startedAt: number): ServerEvent {
    const { room, notices = [] } = outcome;
    const roomActive = room !== undefined && rooms.has(room.code);
    if (roomActive) {
      touch(room, context.timestamp);
      context.success.appliedVersion = room.version;
      logTransition(room, previous);
    }
    const response: ServerEvent = { type: "command.ok", requestId: context.requestId, payload: context.success };
    context.output.deliveries.push({ connectionId: context.connectionId, event: response });
    const round = room?.game.round;
    logger.debug("command.accepted", { ...context.log, roomCode: room?.code ?? context.log.roomCode,
      playerId: sessionForConnection(context.connectionId)?.playerId ?? context.log.playerId,
      version: context.success.appliedVersion, phase: room?.game.phase, roundId: round?.id,
      receivedCount: round?.submissions.size, expectedCount: round?.respondentPlayerIds.length,
      durationMs: elapsedMs(startedAt) });
    if (roomActive) {
      queueNotices(room, notices, context.output);
      queueSnapshots(room, context.output);
    }
    return response;
  }

  function rejectCommand(error: unknown, context: CommandContext, targetRoom: GameRoom | undefined): ServerEvent {
    const ruleError = error instanceof RuleError ? error : null;
    if (ruleError) {
      logger.warn("command.rejected", { ...context.log, errorCode: ruleError.code,
        phase: targetRoom?.game.phase, roundId: targetRoom?.game.round?.id });
    } else {
      logger.error("command.failed", { ...context.log, errorCode: "INTERNAL_ERROR" }, error);
    }
    // Erros inesperados nunca expõem detalhes internos ao cliente.
    const response: ServerEvent = { type: "command.error", requestId: context.requestId, payload: {
      code: ruleError?.code ?? "INTERNAL_ERROR",
      message: ruleError?.code ?? INTERNAL_ERROR_MESSAGE,
    } };
    context.output.deliveries.push({ connectionId: context.connectionId, event: response });
    return response;
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
    const context: CommandContext = {
      connectionId, requestId: command.requestId, timestamp, output, success: { command: command.type },
      log: { connectionId, requestId: command.requestId, command: command.type, roomCode, playerId: activeSession?.playerId },
    };
    logger.debug("command.received", context.log);
    const requestCache = cacheFor(connectionId);
    pruneExpiredRequests(requestCache, timestamp);
    const fingerprint = JSON.stringify([command.type, command.payload]);
    const cached = requestCache.get(command.requestId);
    if (cached && cached.fingerprint === fingerprint && !replacedConnections.has(connectionId)) {
      replayResponse(connectionId, cached, context);
      return output;
    }

    let response: ServerEvent;
    try {
      requireRule(!replacedConnections.has(connectionId), "CONNECTION_REPLACED");
      requireRule(!cached, "REQUEST_ID_REUSED");
      response = acceptCommand(runHandler(command, context), context, previous, startedAt);
    } catch (error) {
      response = rejectCommand(error, context, targetRoom);
    }
    // Não sobrescrever a confirmação original caso o ID seja reutilizado incorretamente.
    if (!cached) rememberResponse(connectionId, command.requestId, { fingerprint, response, createdAt: timestamp });
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


  function closeIfExpired(room: GameRoom, timestamp: number, output: Effects): boolean {
    if (room.game.finishedAt !== null && timestamp - room.game.finishedAt >= FINISHED_ROOM_MS) {
      closeRoom(room, "O prazo de exibição da partida terminou.", output);
      return true;
    }
    if (room.emptySince !== null && timestamp - room.emptySince >= EMPTY_ROOM_MS) {
      closeRoom(room, "A sala foi removida por abandono.", output);
      return true;
    }
    return false;
  }

  function expireDisconnectedPlayers(room: GameRoom, timestamp: number, output: Effects): void {
    const expiredIds = [...room.players.values()]
      .filter(player => !canReconnect(player, timestamp))
      .map(player => player.id);
    if (!expiredIds.length) return;
    const previous = stateSummary(room);
    const notices = removePlayers(room, expiredIds, timestamp, "reconnect_timeout");
    const roomActive = rooms.has(room.code);
    if (roomActive) touch(room, timestamp);
    logger.info("room.sessions_expired", { roomCode: room.code, removedCount: expiredIds.length,
      playerCount: room.players.size, version: room.version });
    if (roomActive) broadcastChange(room, previous, notices, output);
  }

  function applyDueBotAction(room: GameRoom, timestamp: number, output: Effects): void {
    const previous = stateSummary(room);
    const botAction = runDueBotAction(room, catalog, timestamp);
    if (!botAction) return;
    touch(room, timestamp);
    logger.debug("bot.action_applied", { roomCode: room.code, roomMode: room.mode, isBot: true,
      playerId: botAction.playerId, command: botAction.command, roundId: room.game.round?.id,
      phase: room.game.phase, version: room.version });
    broadcastChange(room, previous, botAction.notices, output);
  }

  function maintain(): Effects {
    const output = effects();
    const timestamp = now();
    for (const room of rooms.values()) {
      if (closeIfExpired(room, timestamp, output)) continue;
      expireDisconnectedPlayers(room, timestamp, output);
      if (!rooms.has(room.code)) continue;
      processDue(room, timestamp, output);
      applyDueBotAction(room, timestamp, output);
    }
    return output;
  }

  return { execute, disconnect, maintain };
}

export type RoomService = ReturnType<typeof createRoomService>;
