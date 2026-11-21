import type { GamePhase, RoomMode, RoundResult, ServerEvent, Settings, WinningCombination } from "../../shared/protocol";

export type Card =
  | { id: string; kind: "prompt"; text: string; pick: number; draw: number }
  | { id: string; kind: "response"; text: string };
export interface Catalog { cards: Map<string, Card>; promptIds: string[]; responseIds: string[] }
export interface Deck { drawPile: string[]; discardPile: string[] }
export interface Player {
  id: string;
  nickname: string;
  score: number;
  hand: string[];
  joinedAt: number;
  disconnectedAt: number | null;
  sessionToken: string | null;
  isBot: boolean;
}
export interface Submission { playerId: string; cardIds: string[] }
export interface JudgingOption extends Submission { id: string }
export interface Round {
  id: string;
  number: number;
  judgePlayerId: string;
  promptCardId: string;
  promptText: string;
  pick: number;
  draw: number;
  respondentPlayerIds: string[];
  submissions: Map<string, Submission>;
  options: JudgingOption[];
  result: RoundResult | null;
  cardsSettled: boolean;
  nextRoundAt: number | null;
  remainingResultMs: number | null;
  deadlineAt: number | null;
  remainingPhaseMs: number | null;
}
export interface GameState {
  phase: GamePhase;
  collectivelyPaused: boolean;
  history: WinningCombination[];
  round: Round | null;
  promptDeck: Deck;
  responseDeck: Deck;
  winnerPlayerId: string | null;
  finishReason: "target_reached" | "not_enough_players" | null;
  finishedAt: number | null;
}
export interface GameRoom {
  code: string;
  mode: RoomMode;
  pendingBotAction: {
    roundId: string;
    phase: "submitting" | "judging";
    playerId: string;
    dueAt: number;
  } | null;
  hostPlayerId: string;
  players: Map<string, Player>;
  playerOrder: string[];
  settings: Settings;
  game: GameState;
  version: number;
  createdAt: number;
  updatedAt: number;
  emptySince: number | null;
}
export interface CachedRequest { fingerprint: string; response: ServerEvent; createdAt: number }
export interface Session {
  token: string;
  roomCode: string;
  playerId: string;
  connectionId: string | null;
  requests: Map<string, CachedRequest>;
}
export interface Delivery { connectionId: string; event: ServerEvent }
export interface Effects { deliveries: Delivery[]; closeConnections: string[] }
export type GameNotice =
  | { type: "round.result"; payload: RoundResult }
  | { type: "round.cancelled"; payload: { roundId: string; reason: string } };
