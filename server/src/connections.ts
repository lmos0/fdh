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
  const maxConnections = options.maxConnections ?? 200;

  function send(socket: ServerWebSocket<ConnectionData>, event: ServerEvent): void {
    if (!socket.data.closed && socket.readyState === 1) {
      const result = socket.send(JSON.stringify(event));
      if (result === -1) logger.debug("connection.backpressure", { connectionId: socket.data.id,
        messageType: event.type, bufferedBytes: socket.getBufferedAmount() });
      else if (result === 0) logger.warn("connection.send_failed", { connectionId: socket.data.id, messageType: event.type });
    }
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
      if (socket) close(socket, 4001, "Sessão substituída", "session_replaced");
    }
  }

  function originAllowed(request: Request): boolean {
    const origin = request.headers.get("origin");
    if (!origin) return false;
    if (options.publicOrigin) return origin === options.publicOrigin.replace(/\/$/, "");
    return origin === new URL(request.url).origin ||
      origin === "http://localhost:5173" || origin === "http://127.0.0.1:5173";
  }

  const server = Bun.serve<ConnectionData>({
    port: options.port ?? 3000,
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
        nonce: null, tokens: 20, rateAt: timestamp, strikes: 0, openedAt: timestamp,
      } })) return;
      logger.warn("connection.upgrade_rejected", { reason: "invalid_handshake", status: 426 });
      return new Response("Upgrade WebSocket necessário", { status: 426 });
    },
    websocket: {
      maxPayloadLength: 8 * 1024,
      backpressureLimit: 64 * 1024,
      closeOnBackpressureLimit: true,
      idleTimeout: 120,
      open(socket) {
        if (sockets.size >= maxConnections) { close(socket, 1013, "Servidor cheio", "capacity"); return; }
        sockets.set(socket.data.id, socket);
        send(socket, { type: "server.config", payload: { features } });
        logger.info("connection.opened", { connectionId: socket.data.id, activeConnections: sockets.size });
      },
      message(socket, raw) {
        if (socket.data.closed) return;
        const timestamp = Date.now();
        const data = socket.data;
        data.tokens = Math.min(20, data.tokens + (timestamp - data.rateAt) / 100);
        data.rateAt = timestamp;
        if (data.tokens < 1) {
          logger.warn("connection.rate_limited", { connectionId: data.id, strikes: data.strikes + 1 });
          send(socket, { type: "command.error", payload: { code: "RATE_LIMITED", message: "Muitas mensagens. Aguarde um momento." } });
          if (++data.strikes >= 5) close(socket, 1008, "Limite de mensagens", "rate_limit");
          return;
        }
        data.tokens--;
        try {
          if (typeof raw !== "string") throw new RuleError("INVALID_MESSAGE");
          const message = parseMessage(raw);
          if (message.type === "connection.pong") {
            if (message.payload.nonce === data.nonce) {
              data.lastPongAt = timestamp;
              data.nonce = null;
              logger.debug("connection.heartbeat_received", { connectionId: data.id });
            } else {
              logger.warn("connection.heartbeat_invalid", { connectionId: data.id, strikes: data.strikes + 1 });
              if (++data.strikes >= 5) close(socket, 1008, "Heartbeat inválido", "invalid_heartbeat");
            }
            return;
          }
          dispatch(service.execute(data.id, message));
        } catch (error) {
          const fields = { connectionId: data.id, requestId: error instanceof RuleError ? error.requestId : undefined,
            errorCode: error instanceof RuleError ? error.code : "INVALID_MESSAGE", strikes: data.strikes + 1,
            bytes: typeof raw === "string" ? Buffer.byteLength(raw) : raw.byteLength };
          if (error instanceof RuleError) logger.warn("connection.message_rejected", fields);
          else logger.error("connection.message_failed", fields, error);
          send(socket, { type: "command.error", requestId: error instanceof RuleError ? error.requestId : undefined, payload: {
            code: error instanceof RuleError ? error.code : "INVALID_MESSAGE",
            message: error instanceof RuleError ? error.code : "Mensagem inválida.",
          } });
          if (++data.strikes >= 5) close(socket, 1008, "Mensagens inválidas", "invalid_messages");
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
    for (const socket of sockets.values()) {
      const data = socket.data;
      if (data.closed) continue;
      if (timestamp - data.lastPongAt >= 60_000) {
        logger.warn("connection.heartbeat_timeout", { connectionId: data.id, durationMs: timestamp - data.lastPongAt });
        close(socket, 4000, "Conexão sem resposta", "heartbeat_timeout");
      } else if (timestamp - data.lastPingAt >= 30_000 && data.nonce === null) {
        data.nonce = crypto.randomUUID();
        data.lastPingAt = timestamp;
        logger.debug("connection.heartbeat_sent", { connectionId: data.id });
        send(socket, { type: "connection.ping", payload: { nonce: data.nonce } });
      }
    }
    dispatch(service.maintain());
  }, 1_000);

  async function stop(): Promise<void> {
    const startedAt = performance.now();
    logger.info("server.stopping", { activeConnections: sockets.size, reason: "shutdown" });
    clearInterval(maintenance);
    for (const socket of sockets.values()) {
      send(socket, { type: "server.restarting", payload: {
        message: "O servidor está reiniciando. As partidas em memória serão perdidas.",
      } });
      close(socket, 1012, "Servidor reiniciando", "server_shutdown");
    }
    await server.stop(true);
    logger.info("server.stopped", { durationMs: Math.round(performance.now() - startedAt) });
  }

  return { server, stop };
}
