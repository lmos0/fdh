import type { ServerWebSocket } from "bun";
import type { ServerEvent } from "../../shared/protocol";
import type { Logger } from "../../shared/logging";
import { logger as defaultLogger } from "./logger";
import { RuleError } from "./errors";
import { createHttpHandler } from "./http";
import { parseMessage } from "./protocol";
import { createRoomService } from "./rooms";
import type { Catalog, Effects } from "./types";
import { readFeatureFlags } from "./config";

const DEFAULT_PORT = 3000;
const DEFAULT_MAX_CONNECTIONS = 200;
const MAX_MESSAGE_BYTES = 8 * 1024;
const BACKPRESSURE_LIMIT_BYTES = 64 * 1024;
const IDLE_TIMEOUT_SECONDS = 120;
const MAINTENANCE_INTERVAL_MS = 1_000;
const HEARTBEAT_INTERVAL_MS = 30_000;
const HEARTBEAT_TIMEOUT_MS = 60_000;
/** Balde de fichas: rajada de 20 mensagens, recarga de uma ficha a cada 100 ms (10/s). */
const RATE_LIMIT_BURST = 20;
const RATE_LIMIT_REFILL_MS = 100;
const MAX_STRIKES = 5;
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

const CLOSE_CODES = {
  policyViolation: 1008,
  serviceRestart: 1012,
  tryAgainLater: 1013,
  heartbeatTimeout: 4000,
  sessionReplaced: 4001,
} as const;

interface ConnectionData {
  id: string;
  closed: boolean;
  lastPongAt: number;
  lastPingAt: number;
  nonce: string | null;
  tokens: number;
  rateAt: number;
  strikes: number;
  openedAt: number;
}

export function startServer(options: {
  catalog: Catalog;
  port?: number;
  hostname?: string;
  publicOrigin?: string;
  distDirectory?: string;
  maxConnections?: number;
  logger?: Logger;
  botTestModeEnabled?: boolean;
}) {
  const logger = options.logger ?? defaultLogger;
  const features = { botTestMode: options.botTestModeEnabled ?? readFeatureFlags().botTestMode };
  const service = createRoomService(options.catalog, { logger, botTestModeEnabled: features.botTestMode });
  const sockets = new Map<string, ServerWebSocket<ConnectionData>>();
  const http = createHttpHandler(options.catalog, options.distDirectory, logger);
  const maxConnections = options.maxConnections ?? DEFAULT_MAX_CONNECTIONS;

  function send(socket: ServerWebSocket<ConnectionData>, event: ServerEvent): void {
    if (socket.data.closed || socket.readyState !== WebSocket.OPEN) return;
    // Bun: -1 indica backpressure (enfileirado), 0 indica que a mensagem foi descartada.
    const result = socket.send(JSON.stringify(event));
    if (result === -1) logger.debug("connection.backpressure", { connectionId: socket.data.id,
      messageType: event.type, bufferedBytes: socket.getBufferedAmount() });
    else if (result === 0) logger.warn("connection.send_failed", { connectionId: socket.data.id, messageType: event.type });
  }

  function addStrike(socket: ServerWebSocket<ConnectionData>, closeMessage: string, reason: string): void {
    socket.data.strikes++;
    if (socket.data.strikes >= MAX_STRIKES) close(socket, CLOSE_CODES.policyViolation, closeMessage, reason);
  }

  function consumeRateToken(data: ConnectionData, timestamp: number): boolean {
    data.tokens = Math.min(RATE_LIMIT_BURST, data.tokens + (timestamp - data.rateAt) / RATE_LIMIT_REFILL_MS);
    data.rateAt = timestamp;
    if (data.tokens < 1) return false;
    data.tokens--;
    return true;
  }

  function handlePong(socket: ServerWebSocket<ConnectionData>, nonce: string, timestamp: number): void {
    const data = socket.data;
    if (nonce !== data.nonce) {
      logger.warn("connection.heartbeat_invalid", { connectionId: data.id, strikes: data.strikes + 1 });
      addStrike(socket, "Heartbeat inválido", "invalid_heartbeat");
      return;
    }
    data.lastPongAt = timestamp;
    data.nonce = null;
    logger.debug("connection.heartbeat_received", { connectionId: data.id });
  }

  function rejectMessage(socket: ServerWebSocket<ConnectionData>, raw: string | Buffer, error: unknown): void {
    const data = socket.data;
    const ruleError = error instanceof RuleError ? error : null;
    const fields = { connectionId: data.id, requestId: ruleError?.requestId,
      errorCode: ruleError?.code ?? "INVALID_MESSAGE", strikes: data.strikes + 1,
      bytes: typeof raw === "string" ? Buffer.byteLength(raw) : raw.byteLength };
    if (ruleError) logger.warn("connection.message_rejected", fields);
    else logger.error("connection.message_failed", fields, error);
    send(socket, { type: "command.error", requestId: ruleError?.requestId, payload: {
      code: ruleError?.code ?? "INVALID_MESSAGE",
      message: ruleError?.code ?? "Mensagem inválida.",
    } });
    addStrike(socket, "Mensagens inválidas", "invalid_messages");
  }

  function checkHeartbeat(socket: ServerWebSocket<ConnectionData>, timestamp: number): void {
    const data = socket.data;
    if (data.closed) return;
    if (timestamp - data.lastPongAt >= HEARTBEAT_TIMEOUT_MS) {
      logger.warn("connection.heartbeat_timeout", { connectionId: data.id, durationMs: timestamp - data.lastPongAt });
      close(socket, CLOSE_CODES.heartbeatTimeout, "Conexão sem resposta", "heartbeat_timeout");
      return;
    }
    if (timestamp - data.lastPingAt < HEARTBEAT_INTERVAL_MS || data.nonce !== null) return;
    data.nonce = crypto.randomUUID();
    data.lastPingAt = timestamp;
    logger.debug("connection.heartbeat_sent", { connectionId: data.id });
    send(socket, { type: "connection.ping", payload: { nonce: data.nonce } });
  }

  function close(socket: ServerWebSocket<ConnectionData>, code: number, message: string, reason: string): void {
    if (socket.data.closed) return;
    socket.data.closed = true;
    logger.info("connection.closing", { connectionId: socket.data.id, closeCode: code, reason });
    socket.close(code, message);
  }

  function dispatch(output: Effects): void {
    for (const { connectionId, event } of output.deliveries) {
      const socket = sockets.get(connectionId);
      if (socket) send(socket, event);
    }
    for (const id of output.closeConnections) {
      const socket = sockets.get(id);
      if (socket) close(socket, CLOSE_CODES.sessionReplaced, "Sessão substituída", "session_replaced");
    }
  }

  function originAllowed(request: Request): boolean {
    const origin = request.headers.get("origin");
    if (!origin) return false;
    if (options.publicOrigin) return origin === options.publicOrigin.replace(/\/$/, "");
    return origin === new URL(request.url).origin || DEV_ORIGINS.includes(origin);
  }

  const server = Bun.serve<ConnectionData>({
    port: options.port ?? DEFAULT_PORT,
    hostname: options.hostname ?? "0.0.0.0",
    fetch(request, server) {
      const url = new URL(request.url);
      if (url.pathname !== "/ws") return http(request);
      if (!originAllowed(request)) {
        logger.warn("connection.upgrade_rejected", { reason: "origin_not_allowed", status: 403 });
        return new Response("Origem não permitida", { status: 403 });
      }
      if (sockets.size >= maxConnections) {
        logger.warn("connection.upgrade_rejected", { reason: "capacity", status: 503, activeConnections: sockets.size, maxConnections });
        return new Response("Servidor cheio", { status: 503 });
      }
      const timestamp = Date.now();
      if (server.upgrade(request, { data: {
        id: crypto.randomUUID(), closed: false, lastPongAt: timestamp, lastPingAt: timestamp,
        nonce: null, tokens: RATE_LIMIT_BURST, rateAt: timestamp, strikes: 0, openedAt: timestamp,
      } })) return;
      logger.warn("connection.upgrade_rejected", { reason: "invalid_handshake", status: 426 });
      return new Response("Upgrade WebSocket necessário", { status: 426 });
    },
    websocket: {
      maxPayloadLength: MAX_MESSAGE_BYTES,
      backpressureLimit: BACKPRESSURE_LIMIT_BYTES,
      closeOnBackpressureLimit: true,
      idleTimeout: IDLE_TIMEOUT_SECONDS,
      open(socket) {
        if (sockets.size >= maxConnections) { close(socket, CLOSE_CODES.tryAgainLater, "Servidor cheio", "capacity"); return; }
        sockets.set(socket.data.id, socket);
        send(socket, { type: "server.config", payload: { features } });
        logger.info("connection.opened", { connectionId: socket.data.id, activeConnections: sockets.size });
      },
      message(socket, raw) {
        if (socket.data.closed) return;
        const timestamp = Date.now();
        const data = socket.data;
        if (!consumeRateToken(data, timestamp)) {
          logger.warn("connection.rate_limited", { connectionId: data.id, strikes: data.strikes + 1 });
          send(socket, { type: "command.error", payload: { code: "RATE_LIMITED", message: "Muitas mensagens. Aguarde um momento." } });
          addStrike(socket, "Limite de mensagens", "rate_limit");
          return;
        }
        try {
          if (typeof raw !== "string") throw new RuleError("INVALID_MESSAGE");
          const message = parseMessage(raw);
          if (message.type === "connection.pong") {
            handlePong(socket, message.payload.nonce, timestamp);
            return;
          }
          dispatch(service.execute(data.id, message));
        } catch (error) {
          rejectMessage(socket, raw, error);
        }
      },
      close(socket, code) {
        sockets.delete(socket.data.id);
        // A razão enviada pelo peer pode conter qualquer texto, inclusive credenciais.
        logger.info("connection.closed", { connectionId: socket.data.id, closeCode: code,
          lifetimeMs: Date.now() - socket.data.openedAt, activeConnections: sockets.size });
        dispatch(service.disconnect(socket.data.id));
      },
    },
  });
  logger.info("server.started", { port: server.port, maxConnections,
    promptCount: options.catalog.promptIds.length, responseCount: options.catalog.responseIds.length,
    botTestModeEnabled: features.botTestMode });

  const maintenance = setInterval(() => {
    const timestamp = Date.now();
    for (const socket of sockets.values()) checkHeartbeat(socket, timestamp);
    dispatch(service.maintain());
  }, MAINTENANCE_INTERVAL_MS);

  async function stop(): Promise<void> {
    const startedAt = performance.now();
    logger.info("server.stopping", { activeConnections: sockets.size, reason: "shutdown" });
    clearInterval(maintenance);
    for (const socket of sockets.values()) {
      send(socket, { type: "server.restarting", payload: {
        message: "O servidor está reiniciando. As partidas em memória serão perdidas.",
      } });
      close(socket, CLOSE_CODES.serviceRestart, "Servidor reiniciando", "server_shutdown");
    }
    await server.stop(true);
    logger.info("server.stopped", { durationMs: Math.round(performance.now() - startedAt) });
  }

  return { server, stop };
}
