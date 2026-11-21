import { useCallback, useEffect, useRef, useState } from "react";
import {
  NICKNAME_LENGTH, SWAP_COST_POINTS, TARGET_SCORE_RANGE,
  type CardSwapNotice, type CommandPayloads, type CommandSuccess, type CommandType, type ErrorCode, type FeatureFlags,
  type ServerEvent, type SessionCredential, type Snapshot,
} from "../../../shared/protocol";
import { logger } from "./logger";
import { pointsLabel } from "../points";
import { createGameSoundTracker, type SoundName } from "../audio/state";
import { playSound, stopSounds } from "../audio/player";

// Preservar a chave mantém sessões existentes após a mudança de nome do jogo.
const SESSION_KEY = "de-proposito.session.v1";
const COMMAND_TIMEOUT_MS = 12_000;
const RECONNECT_BASE_DELAY_MS = 700;
const RECONNECT_MAX_DELAY_MS = 10_000;
const RECONNECT_MAX_EXPONENT = 5;
/** Variação de ±20% no atraso evita que todos os clientes reconectem no mesmo instante. */
const RECONNECT_JITTER = 0.4;
/** Erros após os quais a sessão salva não serve mais: voltar à tela inicial. */
const TERMINAL_ERROR_CODES: ReadonlySet<ErrorCode> = new Set(["ROOM_NOT_FOUND", "SESSION_INVALID", "SESSION_EXPIRED", "NOT_IN_ROOM"]);
const REVEAL_SOUNDS: ReadonlySet<SoundName> = new Set(["result", "point", "victory", "judge_confirm", "ending", "judge_ending"]);

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "replaced";
type ServerEventOf<K extends ServerEvent["type"]> = Extract<ServerEvent, { type: K }>;
interface Pending {
  command: CommandType;
  startedAt: number;
  resolve: (result: CommandSuccess) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

const errors: Record<ErrorCode, string> = {
  INVALID_MESSAGE: "A mensagem não pôde ser entendida.",
  UNSUPPORTED_EVENT: "Esta ação não é suportada. Atualize a página.",
  INVALID_NICKNAME: `Use um apelido de ${NICKNAME_LENGTH.min} a ${NICKNAME_LENGTH.max} caracteres, sem caracteres especiais de controle.`,
  INVALID_SETTINGS: `Use uma pontuação inteira de ${TARGET_SCORE_RANGE.min} a ${TARGET_SCORE_RANGE.max} e os intervalos disponíveis no lobby.`,
  ALREADY_IN_ROOM: "Você já está em uma sala. Saia dela antes de entrar em outra.",
  SERVER_FULL: "O servidor está cheio. Tente novamente daqui a pouco.",
  ROOM_NOT_FOUND: "A sala não existe mais ou o código está incorreto.",
  ROOM_FULL: "Esta sala já tem oito participantes.",
  GAME_ALREADY_STARTED: "Esta partida já começou. Só é possível reconectar.",
  TEST_ROOM_PRIVATE: "Esta é uma sala de teste individual. Crie sua própria sala para testar com dois bots.",
  FEATURE_DISABLED: "O modo de teste com bots está desabilitado neste servidor.",
  NICKNAME_TAKEN: "Esse apelido já está em uso nesta sala.",
  SESSION_INVALID: "Sua sessão não existe mais. O servidor pode ter reiniciado.",
  SESSION_EXPIRED: "Seu prazo para reconectar terminou.",
  SESSION_REQUIRED: "Reconecte à sala antes de realizar esta ação.",
  NOT_IN_ROOM: "Você não está mais nesta sala.",
  NOT_HOST: "Somente o anfitrião pode fazer isso.",
  INVALID_PHASE: "Esta ação não está disponível nesta fase da partida.",
  NOT_ENOUGH_PLAYERS: "São necessários pelo menos três participantes para jogar.",
  PLAYERS_DISCONNECTED: "Aguarde todos os participantes reconectarem para começar.",
  DECK_UNAVAILABLE: "Não há cartas suficientes para começar.",
  STALE_ROUND: "Esta rodada já terminou. Confira a rodada atual.",
  GAME_PAUSED: "A partida está em pausa coletiva ou aguardando reconexão.",
  JUDGE_CANNOT_SUBMIT: "O juiz não envia uma resposta nesta rodada.",
  CARD_NOT_IN_HAND: "Esta carta não está na sua mão.",
  INVALID_CARD_COUNT: "Selecione exatamente a quantidade de cartas indicada na pergunta.",
  DUPLICATE_CARDS: "Cada carta só pode ser usada uma vez na mesma resposta.",
  ALREADY_SUBMITTED: "Sua resposta já foi enviada e não pode ser alterada.",
  NOT_JUDGE: "Somente o juiz da rodada pode escolher o vencedor.",
  OPTION_NOT_FOUND: "Esta opção não está disponível.",
  RATE_LIMITED: "Muitas ações em pouco tempo. Aguarde um momento.",
  CONNECTION_REPLACED: "Sua sessão foi aberta em outra conexão.",
  REQUEST_ID_REUSED: "Não foi possível repetir a ação. Tente novamente.",
  INTERNAL_ERROR: "Ocorreu um erro ao concluir a ação. Tente novamente.",
  JUDGE_CANNOT_SWAP: "O juiz não troca cartas nesta rodada.",
  NOT_ENOUGH_POINTS: `Você precisa de pelo menos ${pointsLabel(SWAP_COST_POINTS)} para trocar uma carta.`,
  SWAP_COST_CHANGED: "O custo da troca mudou. Confira e confirme de novo.",
};

function swapNoticeText(notice: CardSwapNotice, selfPlayerId: string | undefined): string {
  const cost = pointsLabel(SWAP_COST_POINTS);
  if (notice.playerId === selfPlayerId) return `Você trocou uma carta e pagou ${cost}.`;
  return `${notice.nickname} trocou uma carta e perdeu ${cost}.`;
}

function isSessionCredential(value: unknown): value is SessionCredential {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.token === "string" && typeof candidate.roomCode === "string" && typeof candidate.playerId === "string";
}

function readSession(): SessionCredential | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
    return isSessionCredential(value) ? value : null;
  } catch {
    logger.warn("session.storage_unavailable", { reason: "read_failed" });
    return null;
  }
}

function reconnectDelay(attempt: number): number {
  const base = Math.min(RECONNECT_MAX_DELAY_MS, RECONNECT_BASE_DELAY_MS * 2 ** Math.min(attempt, RECONNECT_MAX_EXPONENT));
  return base * (1 - RECONNECT_JITTER / 2 + Math.random() * RECONNECT_JITTER);
}

function storeSession(value: SessionCredential | null): void {
  try {
    if (value) sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
    else sessionStorage.removeItem(SESSION_KEY);
  } catch { logger.warn("session.storage_unavailable", { reason: "write_failed" }); }
}

export function useGameConnection() {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [revealRoundId, setRevealRoundId] = useState<string | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [features, setFeatures] = useState<FeatureFlags>({ botTestMode: false });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [generation, setGeneration] = useState(0);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<SessionCredential | null>(readSession());
  const pending = useRef(new Map<string, Pending>());
  const connected = useRef(false);
  const version = useRef(-1);
  const soundTracker = useRef(createGameSoundTracker());

  const clearSession = useCallback(() => {
    soundTracker.current.resync();
    stopSounds();
    logger.info("session.cleared", { roomCode: sessionRef.current?.roomCode });
    sessionRef.current = null;
    storeSession(null);
    version.current = -1;
    setSnapshot(null);
    setRevealRoundId(null);
  }, []);

  const send = useCallback(<K extends CommandType>(type: K, payload: CommandPayloads[K]): Promise<CommandSuccess> => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || (!connected.current && type !== "session.resume")) {
      logger.warn("command.not_sent", { command: type, reason: "not_connected" });
      const message = "Aguarde a conexão com o servidor.";
      setError(message);
      return Promise.reject(new Error(message));
    }
    setError(null);
    const requestId = crypto.randomUUID();
    const startedAt = performance.now();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        logger.warn("command.timeout", { command: type, requestId, roomCode: sessionRef.current?.roomCode,
          durationMs: Math.round(performance.now() - startedAt) });
        pending.current.delete(requestId);
        setPendingCount(pending.current.size);
        setError("A confirmação demorou. O estado será atualizado quando a conexão voltar.");
        reject(new Error("Confirmação não recebida."));
        // Reabrir a conexão recupera o snapshot e evita continuar numa sessão incerta.
        socket.close();
      }, COMMAND_TIMEOUT_MS);
      pending.current.set(requestId, { resolve, reject, timer, command: type, startedAt });
      setPendingCount(pending.current.size);
      logger.debug("command.sent", { requestId, command: type, roomCode: sessionRef.current?.roomCode });
      socket.send(JSON.stringify({ type, requestId, payload }));
    });
  }, []);

  useEffect(() => {
    let disposed = false;
    let replaced = false;
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const hideReveal = () => { if (document.hidden) setRevealRoundId(null); };
    document.addEventListener("visibilitychange", hideReveal);

    function rejectPending() {
      if (pending.current.size) logger.debug("commands.interrupted", { pendingCount: pending.current.size });
      for (const entry of pending.current.values()) {
        clearTimeout(entry.timer);
        entry.reject(new Error("Conexão interrompida."));
      }
      pending.current.clear();
      if (!disposed) setPendingCount(0);
    }

    function takePending(requestId: string | undefined): Pending | undefined {
      const entry = requestId ? pending.current.get(requestId) : undefined;
      if (!entry || !requestId) return undefined;
      clearTimeout(entry.timer);
      pending.current.delete(requestId);
      setPendingCount(pending.current.size);
      return entry;
    }

    function markConnected() {
      attempts = 0;
      connected.current = true;
      setStatus("connected");
    }

    function onCommandOk(message: ServerEventOf<"command.ok">) {
      if (message.payload.session) {
        sessionRef.current = message.payload.session;
        storeSession(message.payload.session);
        version.current = -1;
      }
      if (message.payload.command === "room.leave") clearSession();
      const entry = takePending(message.requestId);
      logger.debug("command.confirmed", { requestId: message.requestId, command: message.payload.command,
        version: message.payload.appliedVersion,
        durationMs: entry ? Math.round(performance.now() - entry.startedAt) : undefined });
      entry?.resolve(message.payload);
    }

    function onCommandError(message: ServerEventOf<"command.error">) {
      logger.warn("command.rejected", { requestId: message.requestId, errorCode: message.payload.code,
        command: message.requestId ? pending.current.get(message.requestId)?.command : undefined,
        roomCode: sessionRef.current?.roomCode });
      // O servidor pode ser mais novo que o cliente e enviar um código ainda sem tradução.
      const text = errors[message.payload.code] ?? message.payload.message;
      setError(text);
      if (TERMINAL_ERROR_CODES.has(message.payload.code) && sessionRef.current) {
        clearSession();
        markConnected();
      }
      takePending(message.requestId)?.reject(new Error(text));
    }

    function onSnapshot(message: ServerEventOf<"state.snapshot">) {
      if (sessionRef.current?.roomCode !== message.roomCode || message.version < version.current) {
        logger.debug("state.ignored", { roomCode: message.roomCode, version: message.version, reason: "stale_or_different_room" });
        return;
      }
      const { room } = message.payload;
      logger.debug("state.received", { roomCode: message.roomCode, version: message.version,
        phase: room.phase, roundId: room.round?.id, playerCount: room.players.length, paused: room.paused });
      version.current = message.version;
      const sound = soundTracker.current.observe(message.payload);
      // Mesmo marcador autoritativo: sem replay em snapshots duplicados, reconexão ou aba oculta.
      if (sound && REVEAL_SOUNDS.has(sound) && !document.hidden) {
        setRevealRoundId(room.round?.result?.roundId ?? null);
      } else if (!room.round?.result) {
        setRevealRoundId(null);
      }
      if (sound) playSound(sound);
      setSnapshot(message.payload);
    }

    function onSessionReplaced(message: ServerEventOf<"session.replaced">) {
      setRevealRoundId(null);
      soundTracker.current.resync();
      stopSounds();
      logger.warn("session.replaced", { roomCode: sessionRef.current?.roomCode });
      replaced = true;
      connected.current = false;
      setStatus("replaced");
      setNotice(message.payload.reason);
    }

    function handleServerEvent(socket: WebSocket, message: ServerEvent) {
      switch (message.type) {
        case "connection.ping":
          socket.send(JSON.stringify({ type: "connection.pong", payload: message.payload }));
          return;
        case "server.config":
          setFeatures({ botTestMode: message.payload.features.botTestMode === true });
          return;
        case "command.ok": return onCommandOk(message);
        case "command.error": return onCommandError(message);
        case "state.snapshot": return onSnapshot(message);
        case "round.cancelled":
          logger.info("round.cancelled", { roomCode: message.roomCode, roundId: message.payload.roundId });
          setNotice(message.payload.reason);
          return;
        case "card.swapped":
          logger.info("card.swapped", { roomCode: message.roomCode, roundId: message.payload.roundId, playerId: message.payload.playerId });
          setNotice(swapNoticeText(message.payload, sessionRef.current?.playerId));
          return;
        case "room.closed":
          logger.info("room.closed", { roomCode: sessionRef.current?.roomCode });
          clearSession();
          setNotice(message.payload.reason);
          return;
        case "session.replaced": return onSessionReplaced(message);
        case "server.restarting":
          logger.warn("server.restarting");
          setNotice(message.payload.message);
          return;
        case "round.result": return; // O resultado durável também está no snapshot.
        default: {
          const unhandled: never = message;
          logger.warn("connection.unknown_event", { messageType: (unhandled as { type?: string }).type });
        }
      }
    }

    function connect() {
      if (disposed || replaced) return;
      setFeatures({ botTestMode: false });
      soundTracker.current.resync();
      logger.info("connection.connecting", { attempt: attempts + 1, roomCode: sessionRef.current?.roomCode });
      connected.current = false;
      setStatus(attempts || sessionRef.current ? "reconnecting" : "connecting");
      const protocol = location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${protocol}//${location.host}/ws`);
      socketRef.current = socket;
      socket.onopen = () => {
        if (disposed) { socket.close(); return; }
        logger.info("connection.opened");
        const session = sessionRef.current;
        if (session) {
          void send("session.resume", { code: session.roomCode, token: session.token }).then(() => {
            if (disposed) return;
            markConnected();
            logger.info("session.resumed", { roomCode: session.roomCode, playerId: session.playerId });
          }).catch(() => { /* A resposta ou onclose determina o próximo estado. */ });
        } else {
          markConnected();
        }
      };
      socket.onmessage = event => {
        if (disposed || socketRef.current !== socket) return;
        let message: ServerEvent;
        try { message = JSON.parse(event.data as string) as ServerEvent; }
        catch {
          logger.error("connection.invalid_server_message", { reason: "invalid_json" });
          setError("Resposta inválida do servidor. Atualize a página.");
          return;
        }
        handleServerEvent(socket, message);
      };
      socket.onclose = event => {
        if (disposed) return;
        setFeatures({ botTestMode: false });
        setRevealRoundId(null);
        soundTracker.current.resync();
        stopSounds();
        logger.info("connection.closed", { closeCode: event.code, clean: event.wasClean,
          roomCode: sessionRef.current?.roomCode });
        connected.current = false;
        rejectPending();
        if (replaced) return;
        setStatus("reconnecting");
        const delay = reconnectDelay(attempts++);
        logger.info("connection.retry_scheduled", { attempt: attempts, delayMs: Math.round(delay) });
        retry = setTimeout(connect, delay);
      };
      socket.onerror = () => {
        // Não registrar o evento: implementações podem incluir URL ou outros dados.
        logger.warn("connection.error", { reason: "network_or_handshake" });
        // onclose aplica backoff, inclusive durante o cold start.
      };
    }

    connect();
    return () => {
      document.removeEventListener("visibilitychange", hideReveal);
      disposed = true;
      connected.current = false;
      clearTimeout(retry);
      rejectPending();
      const socket = socketRef.current;
      if (socket) {
        socket.onclose = null;
        socket.close();
      }
    };
  }, [clearSession, generation, send]);

  const forgetSession = useCallback(() => {
    clearSession();
    setError(null);
    setNotice(null);
    setPendingCount(0);
    setGeneration(value => value + 1);
  }, [clearSession]);

  return {
    snapshot, status, features, revealRoundId, error, notice, busy: pendingCount > 0, send, forgetSession,
    dismissError: () => setError(null), dismissNotice: () => setNotice(null),
  };
}
