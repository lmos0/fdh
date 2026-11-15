import { useState, type FormEvent } from "react";
import { CardFace } from "../components/CardFace";

export function HomeScreen({ disabled, botTestModeEnabled, createRoom, joinRoom, createTestRoom }: {
  disabled: boolean; createRoom: (nickname: string) => void; joinRoom: (code: string, nickname: string) => void;
  botTestModeEnabled: boolean;
  createTestRoom: (nickname: string) => void;
}) {
  const [nickname, setNickname] = useState(() => {
    // Manter a chave antiga preserva o apelido após a mudança de nome do jogo.
    try { return localStorage.getItem("de-proposito.nickname") ?? ""; } catch { return ""; }
  });
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "");
  const [mode, setMode] = useState<"create" | "join">(code ? "join" : "create");
  function submit(event: FormEvent) {
    event.preventDefault();
    try { localStorage.setItem("de-proposito.nickname", nickname.trim()); } catch { /* Opcional. */ }
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    if (mode === "create" && submitter instanceof HTMLButtonElement && submitter.value === "test") {
      if (botTestModeEnabled) createTestRoom(nickname.trim());
    }
    else if (mode === "create") createRoom(nickname.trim());
    else joinRoom(code.trim().toUpperCase(), nickname.trim());
  }

  return <main className="home-layout">
    <section className="panel entry-panel" aria-labelledby="entry-title">
      <div className="entry-illustration" aria-hidden="true">
        <span className="mini-card mini-card-dark"><CardFace mischievous /></span>
        <span className="mini-card mini-card-light"><CardFace /></span>
        <svg className="entry-spark" width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="m10 1 2.2 6.8L19 10l-6.8 2.2L10 19l-2.2-6.8L1 10l6.8-2.2L10 1Z" fill="currentColor" /></svg>
      </div>
      <div className="entry-heading"><h1 id="entry-title">Jogar</h1><span className="muted">3–8 jogadores</span></div>
      <div className="mode-switch" role="group" aria-label="Como jogar">
        <button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")}>Criar sala</button>
        <button type="button" aria-pressed={mode === "join"} onClick={() => setMode("join")}>Entrar com código</button>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="nickname">Seu apelido</label>
        <input id="nickname" name="nickname" value={nickname} onChange={event => setNickname(event.target.value)}
          minLength={2} maxLength={24} autoComplete="nickname" autoCorrect="off" spellCheck={false}
          enterKeyHint={mode === "join" ? "next" : "go"} placeholder="Apelido" required />
        {mode === "join" && <>
          <label htmlFor="room-code">Código da sala</label>
          <input id="room-code" name="room" className="code-input" value={code}
            onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))}
            minLength={6} maxLength={6} autoComplete="off" autoCapitalize="characters" autoCorrect="off"
            enterKeyHint="go" spellCheck={false} placeholder="ABC234" required />
        </>}
        <button className="button primary full" disabled={disabled} type="submit">
          {mode === "create" ? "Criar minha sala" : "Entrar na sala"}
        </button>
        {mode === "create" && botTestModeEnabled && <button className="button secondary full test-mode-button" disabled={disabled}
          type="submit" name="intent" value="test">Testar com 2 bots</button>}
      </form>
    </section>
  </main>;
}
