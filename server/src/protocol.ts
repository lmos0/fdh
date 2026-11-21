import type { ClientMessage } from "../../shared/protocol";
import {
  NICKNAME_LENGTH, PHASE_TIME_LIMITS, PICK_RANGE, RESULT_INTERVALS, SWAP_COSTS, TARGET_SCORE_RANGE,
} from "../../shared/protocol";
import { MAX_CARD_ID_LENGTH } from "./cards";
import { requireRule, RuleError } from "./errors";
import { isBoundedString, isIntegerInRange, isRecord } from "./guards";

const REQUEST_ID_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;
const ROOM_CODE_PATTERN = /^[A-Z2-9]{6}$/;
const CONTROL_CHARACTERS = /[\p{Cc}\p{Cf}]/u;
const MAX_ROOM_CODE_INPUT_LENGTH = 12;
const MAX_TOKEN_LENGTH = 128;
const MAX_ID_LENGTH = 100;
const ENVELOPE_KEYS = ["type", "requestId", "payload"];
const PONG_ENVELOPE_KEYS = ["type", "payload"];

type MessageType = ClientMessage["type"];
type FieldName =
  | "nickname" | "targetScore" | "mode" | "code" | "token" | "phaseTimeLimitSeconds" | "resultIntervalSeconds"
  | "toLobby" | "roundId" | "paused" | "cardIds" | "cardId" | "cost" | "optionId" | "nonce";
type Payload = Record<string, unknown>;
type FieldValidator = (payload: Payload, messageType: MessageType) => void;

const payloadKeys: Record<MessageType, readonly FieldName[]> = {
  "room.create": ["nickname", "targetScore", "mode"], "room.join": ["code", "nickname"],
  "session.resume": ["code", "token"], "room.leave": [],
  "room.configure": ["targetScore", "phaseTimeLimitSeconds", "resultIntervalSeconds"], "game.start": [],
  "game.restart": ["toLobby"],
  "game.pause": ["roundId", "paused"],
  "round.advance": ["roundId"],
  "round.submit": ["roundId", "cardIds"], "round.judge": ["roundId", "optionId"],
  "round.swap": ["roundId", "cardId", "cost"],
  "connection.pong": ["nonce"],
};

const fieldValidators: Record<FieldName, FieldValidator> = {
  targetScore: validateTargetScore,
  phaseTimeLimitSeconds: payload => requireOptionalChoice(payload.phaseTimeLimitSeconds, PHASE_TIME_LIMITS),
  resultIntervalSeconds: payload => requireOptionalChoice(payload.resultIntervalSeconds, RESULT_INTERVALS),
  paused: payload => requireRule(typeof payload.paused === "boolean", "INVALID_MESSAGE"),
  toLobby: payload => requireRule(payload.toLobby === undefined || typeof payload.toLobby === "boolean", "INVALID_MESSAGE"),
  mode: payload => requireRule(payload.mode === undefined || payload.mode === "private" || payload.mode === "test", "INVALID_MESSAGE"),
  cardIds: validateCardIds,
  cardId: payload => requireBoundedString(payload.cardId, MAX_CARD_ID_LENGTH),
  cost: payload => requireRule(SWAP_COSTS.some(cost => cost === payload.cost), "INVALID_MESSAGE"),
  nickname: normalizeNickname,
  code: normalizeRoomCode,
  token: payload => requireBoundedString(payload.token, MAX_TOKEN_LENGTH),
  roundId: payload => requireBoundedString(payload.roundId, MAX_ID_LENGTH),
  optionId: payload => requireBoundedString(payload.optionId, MAX_ID_LENGTH),
  nonce: payload => requireBoundedString(payload.nonce, MAX_ID_LENGTH),
};

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID_PATTERN.test(value);
}

function isMessageType(value: unknown): value is MessageType {
  return typeof value === "string" && Object.hasOwn(payloadKeys, value);
}

export function parseMessage(raw: string): ClientMessage {
  let message: unknown;
  try { message = JSON.parse(raw); } catch { throw new RuleError("INVALID_MESSAGE"); }
  try {
    return validateMessage(message);
  } catch (error) {
    // Devolver o requestId permite ao cliente associar a recusa ao comando pendente.
    if (error instanceof RuleError && isRecord(message) && isRequestId(message.requestId)) error.requestId = message.requestId;
    throw error;
  }
}

function validateMessage(message: unknown): ClientMessage {
  requireRule(isRecord(message), "INVALID_MESSAGE");
  requireRule(typeof message.type === "string", "INVALID_MESSAGE");
  requireRule(isMessageType(message.type), "UNSUPPORTED_EVENT");
  const allowed = payloadKeys[message.type];
  const allowedEnvelopeKeys = message.type === "connection.pong" ? PONG_ENVELOPE_KEYS : ENVELOPE_KEYS;
  requireRule(Object.keys(message).every(key => allowedEnvelopeKeys.includes(key)), "INVALID_MESSAGE");
  requireRule(isRecord(message.payload), "INVALID_MESSAGE");
  const payload = message.payload;
  requireRule(Object.keys(payload).every(key => (allowed as readonly string[]).includes(key)), "INVALID_MESSAGE");
  if (message.type !== "connection.pong") requireRule(isRequestId(message.requestId), "INVALID_MESSAGE");
  for (const key of allowed) fieldValidators[key](payload, message.type);
  // Seguro: tipo, chaves e cada campo foram validados acima.
  return message as unknown as ClientMessage;
}

function requireBoundedString(value: unknown, maxLength: number): void {
  requireRule(isBoundedString(value, maxLength), "INVALID_MESSAGE");
}

function requireOptionalChoice(value: unknown, choices: readonly number[]): void {
  requireRule(value === undefined || value === null || choices.some(choice => choice === value), "INVALID_SETTINGS");
}

function validateTargetScore(payload: Payload, messageType: MessageType): void {
  // Ao criar a sala a meta é opcional; ao configurar, obrigatória.
  if (messageType === "room.create" && payload.targetScore === undefined) return;
  requireRule(isIntegerInRange(payload.targetScore, TARGET_SCORE_RANGE), "INVALID_SETTINGS");
}

function validateCardIds(payload: Payload): void {
  const cardIds = payload.cardIds;
  requireRule(Array.isArray(cardIds) && cardIds.length >= PICK_RANGE.min && cardIds.length <= PICK_RANGE.max, "INVALID_CARD_COUNT");
  requireRule(cardIds.every(id => isBoundedString(id, MAX_CARD_ID_LENGTH)), "INVALID_MESSAGE");
  requireRule(new Set(cardIds).size === cardIds.length, "DUPLICATE_CARDS");
}

function normalizeNickname(payload: Payload): void {
  requireRule(typeof payload.nickname === "string", "INVALID_NICKNAME");
  const nickname = payload.nickname.trim().normalize("NFC");
  const validLength = nickname.length >= NICKNAME_LENGTH.min && nickname.length <= NICKNAME_LENGTH.max;
  requireRule(validLength && !CONTROL_CHARACTERS.test(nickname), "INVALID_NICKNAME");
  payload.nickname = nickname;
}

function normalizeRoomCode(payload: Payload): void {
  const input = payload.code;
  requireRule(isBoundedString(input, MAX_ROOM_CODE_INPUT_LENGTH), "INVALID_MESSAGE");
  const code = input.trim().toUpperCase();
  requireRule(ROOM_CODE_PATTERN.test(code), "ROOM_NOT_FOUND");
  payload.code = code;
}
