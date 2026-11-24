export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

// Lista permitida em vez de serializar objetos de domínio, mensagens ou erros inteiros.
const fieldNames = [
  "connectionId", "previousConnectionId", "requestId", "command", "messageType",
  "roomCode", "playerId", "hostPlayerId", "previousHostPlayerId", "judgePlayerId", "winnerPlayerId",
  "roundId", "roundNumber", "phase", "previousPhase", "version", "paused", "playerCount",
  "connectedPlayers", "activeRooms", "activeConnections", "maxConnections", "maxRooms",
  "targetScore", "phaseTimeLimitSeconds", "resultIntervalSeconds", "collectivelyPaused", "pick", "draw", "receivedCount", "expectedCount", "removedCount",
  "reason", "errorCode", "errorName", "errorFrames", "method", "route", "status",
  "durationMs", "lifetimeMs", "closeCode", "clean", "attempt", "delayMs", "pendingCount",
  "bytes", "bufferedBytes", "strikes", "port", "promptCount", "responseCount", "signal",
  "roomMode", "isBot", "botTestModeEnabled", "swapCost", "cardCount",
] as const;

export type LogFields = Partial<Record<typeof fieldNames[number], string | number | boolean | null>>;
export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields, error?: unknown): void;
}

const priorities: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

export function logLevel(value: string | undefined, fallback: LogLevel = "info"): LogLevel {
  return value && Object.hasOwn(priorities, value) ? value as LogLevel : fallback;
}

export function createLogger(options: {
  level?: LogLevel;
  scope?: "server" | "client";
  instanceId?: string;
  now?: () => number;
  write?: (line: string, level: Exclude<LogLevel, "silent">) => void;
} = {}): Logger {
  const threshold = priorities[options.level ?? "info"];
  const instanceId = options.instanceId ?? crypto.randomUUID();
  const now = options.now ?? Date.now;
  const write = options.write ?? ((line, level) => {
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else if (level === "debug") console.debug(line);
    else console.info(line);
  });

  function emit(level: Exclude<LogLevel, "silent">, event: string, fields: LogFields = {}, error?: unknown) {
    if (priorities[level] < threshold) return;
    try {
      const safe: LogFields = {};
      for (const key of fieldNames) {
        const value = fields[key];
        if (typeof value === "string") safe[key] = value.slice(0, key === "errorFrames" ? 1_500 : 160);
        else if (typeof value === "boolean" || value === null) safe[key] = value;
        else if (typeof value === "number" && Number.isFinite(value)) safe[key] = value;
      }
      if (error instanceof Error) {
        // A mensagem de um erro pode conter JSON, credenciais ou texto de cartas.
        // Guardar apenas a categoria e locais do código, nunca message/cause.
        safe.errorName = error.constructor.name.slice(0, 80);
        const stack = error.stack ?? "";
        const header = error.message ? `${error.name}: ${error.message}` : error.name;
        // Remover também mensagens multilinha antes de procurar frames.
        const frames = stack.startsWith(header) ? stack.slice(header.length) : "";
        safe.errorFrames = frames.split("\n")
          .filter(line => /^\s+at\s/.test(line)).slice(0, 6).join("\n").slice(0, 1_500);
      }
      write(JSON.stringify({ timestamp: new Date(now()).toISOString(), level,
        scope: options.scope ?? "server", instanceId, event: event.slice(0, 100), ...safe }), level);
    } catch {
      // Falhas na saída de logs nunca devem interromper uma partida.
    }
  }

  return {
    debug: (event, fields) => emit("debug", event, fields),
    info: (event, fields) => emit("info", event, fields),
    warn: (event, fields) => emit("warn", event, fields),
    error: (event, fields, error) => emit("error", event, fields, error),
  };
}
