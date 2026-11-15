import type { CSSProperties } from "react";
import type { PlayerView } from "../../../shared/protocol";
import { JudgeIcon } from "./JudgeIcon";
import { PlayerAvatar } from "./PlayerAvatar";

export function PlayerList({ players, selfId, hostId, judgeId, awardedPlayerId, celebrate = false, targetScore }: {
  players: PlayerView[]; selfId: string; hostId: string; judgeId?: string; awardedPlayerId?: string; celebrate?: boolean;
  /** Com a meta, mostra pontos e progresso; sem ela (sala de espera), só as pessoas. */
  targetScore?: number;
}) {
  return <ul className="player-list">
    {players.map(player => <li key={player.id} className={`${player.id === judgeId ? "player-judge" : ""} ${player.id === awardedPlayerId ? "player-winner" : ""} ${player.connected ? "" : "player-offline"}`}>
      <span className="player-face"><PlayerAvatar nickname={player.nickname} />
        <span className={`presence ${player.connected ? "online" : ""}`} role="img" aria-label={player.connected ? "Conectado" : "Desconectado"} /></span>
      <span className="player-info">
        <span className="player-name">{player.nickname}{player.id === selfId && <small> você</small>}</span>
        <span className="player-badges">
          {player.id === judgeId && <span className="badge judge-badge"><JudgeIcon />Juiz</span>}
          {player.id === hostId && <span className="badge">anfitrião</span>}
          {player.isBot && <span className="badge bot-badge">Bot</span>}
          {!player.connected && <span className="badge offline-badge">reconectando</span>}
        </span>
      </span>
      {targetScore !== undefined && <>
        <strong className="score" aria-label={player.score === 1 ? "1 ponto" : `${player.score} pontos`}>{player.score}<small> {player.score === 1 ? "pt" : "pts"}</small>{player.id === awardedPlayerId &&
          <span className={`point-gain ${celebrate ? "is-revealing" : ""}`} aria-hidden="true">+1</span>}</strong>
        <span className="score-track" aria-hidden="true"><span style={{ "--progress": Math.min(1, player.score / targetScore) } as CSSProperties} /></span>
      </>}
    </li>)}
  </ul>;
}
