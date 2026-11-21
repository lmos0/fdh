import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CommandPayloads, CommandSuccess, CommandType, ErrorCode, FeatureFlags, ServerEvent, SessionCredential, Snapshot,
} from "../../../shared/protocol";
import { logger } from "./logger";
import { createGameSoundTracker } from "../audio/state";
import { playSound, stopSounds } from "../audio/player";

// Preservar a chave mantém sessões existentes após a mudança de nome do jogo.
const SESSION_KEY = "de-proposito.session.v1";
type Status = "connecting" | "connected" | "reconnecting" | "replaced";
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
  INVALID_NICKNAME: "Use um apelido de 2 a 24 caracteres, sem caracteres especiais de controle.",
  INVALID_SETTINGS: "Use uma pontuação inteira de 3 a 20 e os intervalos disponíveis no lobby.",
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
};

function readSession(): SessionCredential | null {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "null");
    if (value && typeof value === "object" && "token" in value && "roomCode" in value && "playerId" in value &&
        typeof value.token === "string" && typeof value.roomCode === "string" && typeof value.playerId === "string") {
      return value as SessionCredential;
    }
  } catch { logger.warn("session.storage_unavailable", { reason: "read_failed" }); }
  return null;
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
  const [status, setStatus] = useState<Status>("connecting");
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
      }, 12_000);
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
            attempts = 0;
            connected.current = true;
            setStatus("connected");
            logger.info("session.resumed", { roomCode: session.roomCode, playerId: session.playerId });
          }).catch(() => { /* A resposta ou onclose determina o próximo estado. */ });
        } else {
          attempts = 0;
          connected.current = true;
          setStatus("connected");
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
        if (message.type === "connection.ping") {
          socket.send(JSON.stringify({ type: "connection.pong", payload: message.payload }));
          return;
        }
        switch (message.type) {
          case "server.config":
            setFeatures({ botTestMode: message.payload.features.botTestMode === true });
            break;
          case "command.ok": {
            if (message.payload.session) {
              sessionRef.current = message.payload.session;
              storeSession(message.payload.session);
              version.current = -1;
            }
            if (message.payload.command === "room.leave") clearSession();
            const entry = pending.current.get(message.requestId);
            logger.debug("command.confirmed", { requestId: message.requestId, command: message.payload.command,
              version: message.payload.appliedVersion,
              durationMs: entry ? Math.round(performance.now() - entry.startedAt) : undefined });
            if (entry) {
              clearTimeout(entry.timer);
              pending.current.delete(message.requestId);
              setPendingCount(pending.current.size);
              entry.resolve(message.payload);
            }
            break;
          }
          case "command.error": {
            logger.warn("command.rejected", { requestId: message.requestId, errorCode: message.payload.code,
              command: message.requestId ? pending.current.get(message.requestId)?.command : undefined,
              roomCode: sessionRef.current?.roomCode });
            const text = errors[message.payload.code] ?? message.payload.message;
            setError(text);
            const terminal = ["ROOM_NOT_FOUND", "SESSION_INVALID", "SESSION_EXPIRED", "NOT_IN_ROOM"].includes(message.payload.code);
            if (terminal && sessionRef.current) {
              clearSession();
              connected.current = true;
              attempts = 0;
              setStatus("connected");
            }
            if (message.requestId) {
              const entry = pending.current.get(message.requestId);
              if (entry) {
                clearTimeout(entry.timer);
                pending.current.delete(message.requestId);
                setPendingCount(pending.current.size);
                entry.reject(new Error(text));
              }
            }
            break;
          }
          case "state.snapshot":
            if (sessionRef.current?.roomCode === message.roomCode && message.version >= version.current) {
              logger.debug("state.received", { roomCode: message.roomCode, version: message.version,
                phase: message.payload.room.phase, roundId: message.payload.room.round?.id,
                playerCount: message.payload.room.players.length, paused: message.payload.room.paused });
              version.current = message.version;
              const sound = soundTracker.current.observe(message.payload);
              // Mesmo marcador autoritativo: sem replay em snapshots duplicados, reconexão ou aba oculta.
              if (sound && ["result", "point", "victory", "judge_confirm", "ending", "judge_ending"].includes(sound) && !document.hidden) {
                setRevealRoundId(message.payload.room.round?.result?.roundId ?? null);
              } else if (!message.payload.room.round?.result) {
                setRevealRoundId(null);
              }
              if (sound) playSound(sound);
              setSnapshot(message.payload);
            } else logger.debug("state.ignored", { roomCode: message.roomCode, version: message.version,
              reason: "stale_or_different_room" });
            break;
          case "round.cancelled":
            logger.info("round.cancelled", { roomCode: message.roomCode, roundId: message.payload.roundId });
            setNotice(message.payload.reason);
            break;
          case "room.closed":
            logger.info("room.closed", { roomCode: sessionRef.current?.roomCode });
            clearSession();
            setNotice(message.payload.reason);
            break;
          case "session.replaced":
            setRevealRoundId(null);
            soundTracker.current.resync();
            stopSounds();
            logger.warn("session.replaced", { roomCode: sessionRef.current?.roomCode });
            replaced = true;
            connected.current = false;
            setStatus("replaced");
            setNotice(message.payload.reason);
            break;
          case "server.restarting":
            logger.warn("server.restarting");
            setNotice(message.payload.message);
            break;
          case "round.result": break; // O resultado durável também está no snapshot.
        }
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
        const delay = Math.min(10_000, 700 * 2 ** Math.min(attempts++, 5)) * (0.8 + Math.random() * 0.4);
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
