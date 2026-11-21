import type { ClientMessage } from "../../shared/protocol";
import { requireRule, RuleError } from "./errors";
import { PHASE_TIME_LIMITS, RESULT_INTERVALS } from "../../shared/protocol";

const payloadKeys: Record<string, string[]> = {
  "room.create": ["nickname", "targetScore", "mode"], "room.join": ["code", "nickname"],
  "session.resume": ["code", "token"], "room.leave": [],
  "room.configure": ["targetScore", "phaseTimeLimitSeconds", "resultIntervalSeconds"], "game.start": [],
  "game.restart": ["toLobby"],
  "game.pause": ["roundId", "paused"],
  "round.advance": ["roundId"],
  "round.submit": ["roundId", "cardIds"], "round.judge": ["roundId", "optionId"],
  "connection.pong": ["nonce"],
};

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function parseMessage(raw: string): ClientMessage {
  let message: unknown;
  try { message = JSON.parse(raw); } catch { throw new RuleError("INVALID_MESSAGE"); }
  try {
    return validateMessage(message);
  } catch (error) {
    if (error instanceof RuleError && record(message) && typeof message.requestId === "string" &&
        /^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId)) error.requestId = message.requestId;
    throw error;
  }
}

function validateMessage(message: unknown): ClientMessage {
  requireRule(record(message), "INVALID_MESSAGE");
  requireRule(typeof message.type === "string", "INVALID_MESSAGE");
  requireRule(Object.hasOwn(payloadKeys, message.type), "UNSUPPORTED_EVENT");
  const allowed = payloadKeys[message.type]!;
  requireRule(Object.keys(message).every(key => ["type", "requestId", "payload"].includes(key)), "INVALID_MESSAGE");
  requireRule(record(message.payload), "INVALID_MESSAGE");
  const payload = message.payload;
  requireRule(Object.keys(payload).every(key => allowed.includes(key)), "INVALID_MESSAGE");
  if (message.type !== "connection.pong") {
    requireRule(typeof message.requestId === "string" && /^[a-zA-Z0-9_-]{1,80}$/.test(message.requestId), "INVALID_MESSAGE");
  }
  const stringField = (key: string, max = 100) => {
    requireRule(typeof payload[key] === "string" && payload[key].length > 0 && payload[key].length <= max, "INVALID_MESSAGE");
  };
  for (const key of allowed) {
    if (key === "targetScore") {
      if (message.type === "room.create" && payload[key] === undefined) continue;
      requireRule(Number.isInteger(payload[key]) && Number(payload[key]) >= 3 && Number(payload[key]) <= 20, "INVALID_SETTINGS");
    } else if (key === "phaseTimeLimitSeconds" || key === "resultIntervalSeconds") {
      requireRule(payload[key] === undefined || payload[key] === null ||
        (key === "phaseTimeLimitSeconds" ? PHASE_TIME_LIMITS : RESULT_INTERVALS).some(value => value === payload[key]), "INVALID_SETTINGS");
    } else if (key === "paused") {
      requireRule(typeof payload[key] === "boolean", "INVALID_MESSAGE");
    } else if (key === "toLobby") {
      requireRule(payload[key] === undefined || typeof payload[key] === "boolean", "INVALID_MESSAGE");
    } else if (key === "mode") {
      requireRule(payload.mode === undefined || payload.mode === "private" || payload.mode === "test", "INVALID_MESSAGE");
    } else if (key === "cardIds") {
      requireRule(Array.isArray(payload.cardIds) && payload.cardIds.length >= 1 && payload.cardIds.length <= 3, "INVALID_CARD_COUNT");
      requireRule(payload.cardIds.every(id => typeof id === "string" && id.length > 0 && id.length <= 100), "INVALID_MESSAGE");
      requireRule(new Set(payload.cardIds).size === payload.cardIds.length, "DUPLICATE_CARDS");
    } else if (key === "nickname") {
      requireRule(typeof payload.nickname === "string", "INVALID_NICKNAME");
      const nickname = payload.nickname.trim().normalize("NFC");
      requireRule(nickname.length >= 2 && nickname.length <= 24 && !/[\p{Cc}\p{Cf}]/u.test(nickname), "INVALID_NICKNAME");
      payload.nickname = nickname;
    } else if (key === "code") {
      stringField(key, 12);
      payload.code = (payload.code as string).trim().toUpperCase();
      requireRule(/^[A-Z2-9]{6}$/.test(payload.code as string), "ROOM_NOT_FOUND");
    } else {
      stringField(key, key === "token" ? 128 : 100);
    }
  }
  return message as unknown as ClientMessage;
}
