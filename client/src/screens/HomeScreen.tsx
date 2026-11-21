import { useState, type FormEvent } from "react";
import { TableStage } from "../table/TableStage";
import { preview } from "../table/model";
import { MAX_PLAYERS, MIN_PLAYERS, NICKNAME_LENGTH } from "../../../shared/protocol";

// Manter a chave antiga preserva o apelido após a mudança de nome do jogo.
const NICKNAME_KEY = "de-proposito.nickname";
const ROOM_CODE_LENGTH = 6;

export function HomeScreen({ disabled, botTestModeEnabled, createRoom, joinRoom, createTestRoom }: {
  disabled: boolean; createRoom: (nickname: string) => void; joinRoom: (code: string, nickname: string) => void;
  botTestModeEnabled: boolean;
  createTestRoom: (nickname: string) => void;
}) {
  const [nickname, setNickname] = useState(() => {
    try { return localStorage.getItem(NICKNAME_KEY) ?? ""; } catch { /* Armazenamento bloqueado: começar vazio. */ return ""; }
  });
  const [code, setCode] = useState(() => new URLSearchParams(location.search).get("room")?.toUpperCase() ?? "");
  const [mode, setMode] = useState<"create" | "join">(code ? "join" : "create");
  function submit(event: FormEvent) {
    event.preventDefault();
    const trimmedNickname = nickname.trim();
    try { localStorage.setItem(NICKNAME_KEY, trimmedNickname); } catch { /* Lembrar o apelido é opcional. */ }
    if (mode === "join") {
      joinRoom(code.trim().toUpperCase(), trimmedNickname);
      return;
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const wantsTestRoom = submitter instanceof HTMLButtonElement && submitter.value === "test";
    if (!wantsTestRoom) {
      createRoom(trimmedNickname);
      return;
    }
    if (botTestModeEnabled) createTestRoom(trimmedNickname);
  }

  return <main className="home-layout edition-home">
    <div className="edition-intro">
      <span className="edition-kicker">FDH com amigos · Edição de mesa</span>
      <h2>Quem deixou isso no baralho?</h2>
      <p>Complete a frase. Dispute a risada do juiz.</p>
      <TableStage model={preview} title="A mesa está posta" preview />
    </div>
    <section className="panel entry-panel" aria-labelledby="entry-title">
      <div className="entry-heading"><h1 id="entry-title">Jogar</h1><span className="muted">{MIN_PLAYERS}–{MAX_PLAYERS} jogadores</span></div>
      <div className="mode-switch" role="group" aria-label="Como jogar">
        <button type="button" aria-pressed={mode === "create"} onClick={() => setMode("create")}>Criar sala</button>
        <button type="button" aria-pressed={mode === "join"} onClick={() => setMode("join")}>Entrar com código</button>
      </div>
      <form onSubmit={submit}>
        <label htmlFor="nickname">Seu apelido</label>
        <input id="nickname" name="nickname" value={nickname} onChange={event => setNickname(event.target.value)}
          minLength={NICKNAME_LENGTH.min} maxLength={NICKNAME_LENGTH.max} autoComplete="nickname" autoCorrect="off" spellCheck={false}
          enterKeyHint={mode === "join" ? "next" : "go"} placeholder="Apelido" required />
        {mode === "join" && <>
          <label htmlFor="room-code">Código da sala</label>
          <input id="room-code" name="room" className="code-input" value={code}
            onChange={event => setCode(event.target.value.toUpperCase().replace(/[^A-Z2-9]/g, ""))}
            minLength={ROOM_CODE_LENGTH} maxLength={ROOM_CODE_LENGTH} autoComplete="off" autoCapitalize="characters" autoCorrect="off"
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
