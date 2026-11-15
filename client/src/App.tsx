import { useState } from "react";
import { useGameConnection } from "./connection/useGameConnection";
import { GameScreen } from "./screens/GameScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { LobbyScreen } from "./screens/LobbyScreen";
import { Brand } from "./components/Brand";
import { ThemeToggle } from "./components/ThemeToggle";
import { SoundControls } from "./components/SoundControls";
import { CardFace } from "./components/CardFace";
import { GameMenu } from "./components/GameMenu";

export default function App() {
  const connection = useGameConnection();
  const { snapshot, status, features, busy, send } = connection;
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const disabled = status !== "connected" || busy;
  const inGame = snapshot !== null && snapshot.room.phase !== "lobby";
  const run = (promise: Promise<unknown>) => { void promise.catch(() => {}); };
  const statusText = status === "connected" ? "Conectado" : status === "replaced" ? "Sessão substituída" : status === "reconnecting" ? "Reconectando…" : "Conectando…";
  async function copyInvite() {
    if (!snapshot) return;
    const url = new URL(location.origin);
    url.searchParams.set("room", snapshot.room.code);
    try {
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setCopyFailed(false);
      setTimeout(() => setCopied(false), 2_000);
    } catch { setCopyFailed(true); }
  }
  function leave() {
    if (!snapshot) return;
    if (snapshot.room.phase !== "lobby" && snapshot.room.phase !== "finished" &&
        !window.confirm("Sair pode cancelar a rodada ou encerrar a partida. Deseja sair?")) return;
    run(send("room.leave", {}));
  }

  return <div className="app-shell">
    <header className={`site-header ${inGame ? "game-header" : ""}`}><Brand compact={inGame} />
      <div className="header-actions">{inGame ? <>
        <div className="compact-room"><span className="room-code">{snapshot.room.mode === "test" ? "Teste" : snapshot.room.code}</span>
          <span className="connection-status" role="status" aria-label={statusText}><span className={`presence ${status === "connected" ? "online" : ""}`} /><span className="sr-only">{statusText}</span></span>
        </div>
        <SoundControls />
        <GameMenu>
          <a className="catalog-link" href="/cards" target="_blank" rel="noopener noreferrer">Ver cartas</a>
          {snapshot.room.mode !== "test" && <button className="button secondary full" onClick={() => void copyInvite()}>{copied ? "Convite copiado!" : "Copiar convite"}</button>}
          <div className="menu-theme"><span>Tema</span><ThemeToggle /></div>
          <button className="button ghost full" disabled={disabled} onClick={leave}>Sair</button>
        </GameMenu>
      </> : <>
        <a className="catalog-link" href="/cards" target="_blank" rel="noopener noreferrer">Ver cartas</a>
        <span className="connection-status" role="status"><span className={`presence ${status === "connected" ? "online" : ""}`} />{statusText}</span>
        {snapshot && <button className="button ghost small" disabled={disabled} onClick={leave}>Sair</button>}
        <SoundControls /><ThemeToggle />
      </>}
      </div>
    </header>
    <div className="notifications">
      {snapshot?.room.mode === "test" && <div className="test-mode-notice" role="note" aria-label="Modo de teste">
        <span className="badge">Modo de teste</span><span>Você + 2 bots. Eles respondem e julgam aleatoriamente.</span>
      </div>}
      {status !== "connected" && <div className="banner warning" role="status">
        <CardFace expression="sleepy" />
        <span>{status === "replaced" ? "Esta sessão está sendo usada em outra conexão." : "Conectando ao servidor. No plano gratuito, a primeira conexão pode levar cerca de um minuto."}</span>
        {status === "replaced" && <button onClick={connection.forgetSession}>Voltar ao início</button>}
      </div>}
      {connection.error && <div className="banner error" role="alert"><span>{connection.error}</span><button aria-label="Fechar erro" onClick={connection.dismissError}>×</button></div>}
      {connection.notice && <div className="banner info" role="status"><span>{connection.notice}</span><button aria-label="Fechar aviso" onClick={connection.dismissNotice}>×</button></div>}
      {copyFailed && snapshot && snapshot.room.mode !== "test" && <div className="banner info">Copie este link: <input aria-label="Link de convite" readOnly value={`${location.origin}/?room=${snapshot.room.code}`} onFocus={event => event.currentTarget.select()} /><button aria-label="Fechar link" onClick={() => setCopyFailed(false)}>×</button></div>}
    </div>
    {!snapshot ? <HomeScreen disabled={disabled} botTestModeEnabled={features.botTestMode}
      createRoom={nickname => run(send("room.create", { nickname }))}
      createTestRoom={nickname => run(send("room.create", { nickname, mode: "test" }))}
      joinRoom={(code, nickname) => run(send("room.join", { code, nickname }))} />
      : snapshot.room.phase === "lobby" ? <LobbyScreen snapshot={snapshot} disabled={disabled} copyInvite={() => void copyInvite()} copied={copied} configure={settings => run(send("room.configure", settings))} start={() => run(send("game.start", {}))} />
      : <GameScreen key={snapshot.room.round?.id ?? "finished"} snapshot={snapshot} revealRoundId={connection.revealRoundId} disabled={disabled} submit={(roundId, cardIds) => run(send("round.submit", { roundId, cardIds }))} judge={(roundId, optionId) => run(send("round.judge", { roundId, optionId }))} pause={(roundId, paused) => run(send("game.pause", { roundId, paused }))} advance={roundId => run(send("round.advance", { roundId }))} leave={leave} />}
    <footer className="site-footer">Reinícios do servidor apagam as partidas.</footer>
  </div>;
}
