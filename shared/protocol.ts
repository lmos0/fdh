export type GamePhase = "lobby" | "submitting" | "judging" | "round_result" | "finished";
export type RoomMode = "private" | "test";
export interface FeatureFlags { botTestMode: boolean }
export const PHASE_TIME_LIMITS = [30, 60, 90, 120, 180] as const;
export const RESULT_INTERVALS = [5, 10, 15, 20, 30] as const;
export interface Settings { targetScore: number; phaseTimeLimitSeconds: number | null; resultIntervalSeconds: number | null }
export interface CardView { id: string; text: string }
export interface PromptView extends CardView { pick: number; draw: number }
export interface AnswerOptionView { id: string; responses: string[] }
export interface CardCatalogView { prompts: PromptView[]; responses: CardView[] }
export interface PlayerView { id: string; nickname: string; score: number; connected: boolean; isBot: boolean }
export interface ScoreView { playerId: string; nickname: string; score: number }
export interface RoundResult {
  roundId: string;
  winnerPlayerId: string;
  winnerNickname: string;
  winningOptionId: string;
  responseTexts: string[];
  scores: ScoreView[];
}
export interface WinningCombination { roundNumber: number; prompt: PromptView; result: RoundResult }
export interface RoomPublicState {
  code: string;
  mode: RoomMode;
  hostPlayerId: string;
  settings: Settings;
  players: PlayerView[];
  phase: GamePhase;
  paused: boolean;
  collectivelyPaused: boolean;
  history: WinningCombination[];
  round: {
    id: string;
    number: number;
    judgePlayerId: string;
    prompt: PromptView;
    receivedCount: number;
    expectedCount: number;
    options: AnswerOptionView[];
    result: RoundResult | null;
    nextRoundAt: number | null;
    deadlineAt: number | null;
    remainingPhaseMs: number | null;
    remainingResultMs: number | null;
  } | null;
  winnerPlayerId: string | null;
  finishReason: "target_reached" | "not_enough_players" | null;
}
export interface PlayerPrivateState {
  playerId: string;
  hand: CardView[];
  submitted: boolean;
  submittedResponses: CardView[];
}
export interface Snapshot { room: RoomPublicState; self: PlayerPrivateState; serverNow: number }

export interface CommandPayloads {
  "room.create": { nickname: string; targetScore?: number; mode?: RoomMode };
  "room.join": { code: string; nickname: string };
  "session.resume": { code: string; token: string };
  "room.leave": Record<string, never>;
  "room.configure": { targetScore: number; phaseTimeLimitSeconds?: number | null; resultIntervalSeconds?: number | null };
  "game.start": Record<string, never>;
  "game.restart": { toLobby?: boolean };
  "game.pause": { roundId: string; paused: boolean };
  "round.advance": { roundId: string };
  "round.submit": { roundId: string; cardIds: string[] };
  "round.judge": { roundId: string; optionId: string };
}
export type CommandType = keyof CommandPayloads;
export type ClientCommand = {
  [K in CommandType]: { type: K; requestId: string; payload: CommandPayloads[K] }
}[CommandType];
export type ClientMessage = ClientCommand | { type: "connection.pong"; payload: { nonce: string } };

export type ErrorCode =
  | "INVALID_MESSAGE" | "UNSUPPORTED_EVENT" | "INVALID_NICKNAME" | "INVALID_SETTINGS"
  | "ALREADY_IN_ROOM" | "SERVER_FULL" | "ROOM_NOT_FOUND" | "ROOM_FULL"
  | "GAME_ALREADY_STARTED" | "NICKNAME_TAKEN" | "SESSION_INVALID" | "SESSION_EXPIRED"
  | "SESSION_REQUIRED" | "NOT_IN_ROOM" | "NOT_HOST" | "INVALID_PHASE"
  | "NOT_ENOUGH_PLAYERS" | "PLAYERS_DISCONNECTED" | "DECK_UNAVAILABLE"
  | "STALE_ROUND" | "GAME_PAUSED" | "JUDGE_CANNOT_SUBMIT" | "CARD_NOT_IN_HAND"
  | "INVALID_CARD_COUNT" | "DUPLICATE_CARDS"
  | "ALREADY_SUBMITTED" | "NOT_JUDGE" | "OPTION_NOT_FOUND" | "RATE_LIMITED"
  | "CONNECTION_REPLACED" | "REQUEST_ID_REUSED" | "INTERNAL_ERROR" | "TEST_ROOM_PRIVATE" | "FEATURE_DISABLED";

export interface SessionCredential { roomCode: string; playerId: string; token: string }
export interface CommandSuccess {
  command: CommandType;
  appliedVersion?: number;
  session?: SessionCredential;
}
interface StateEnvelope { roomCode: string; version: number }
export type ServerEvent =
  | { type: "server.config"; payload: { features: FeatureFlags } }
  | { type: "command.ok"; requestId: string; payload: CommandSuccess }
  | { type: "command.error"; requestId?: string; payload: { code: ErrorCode; message: string } }
  | (StateEnvelope & { type: "state.snapshot"; payload: Snapshot })
  | (StateEnvelope & { type: "round.result"; payload: RoundResult })
  | (StateEnvelope & { type: "round.cancelled"; payload: { roundId: string; reason: string } })
  | { type: "session.replaced"; payload: { reason: string } }
  | { type: "room.closed"; payload: { reason: string } }
  | { type: "server.restarting"; payload: { message: string } }
  | { type: "connection.ping"; payload: { nonce: string } };
