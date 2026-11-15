import type { CSSProperties } from "react";

// Fundos claros com texto escuro: legíveis nos dois temas.
const PALETTE = [
  ["#ffd6e7", "#7a1f4b"], ["#d9e8ff", "#1f3f7a"], ["#d8f3e3", "#1d5c3c"], ["#fff0c7", "#6b4a08"],
  ["#ead9ff", "#4a2a80"], ["#ffdccc", "#7a3414"], ["#d2f1f4", "#145560"], ["#e8e8ee", "#3a3a4a"],
] as const;

export function PlayerAvatar({ nickname, large = false }: { nickname: string; large?: boolean }) {
  const words = nickname.trim().split(/\s+/);
  const initials = words.length > 1 ? `${Array.from(words[0]!)[0] ?? ""}${Array.from(words.at(-1)!)[0] ?? ""}`
    : Array.from(words[0] ?? "?").slice(0, 2).join("");
  // A cor depende só do apelido, então é a mesma para todos na sala.
  let hash = 0;
  for (const character of nickname) hash = (hash * 31 + character.codePointAt(0)!) >>> 0;
  const [background, color] = PALETTE[hash % PALETTE.length]!;
  return <span className={`player-avatar ${large ? "large" : ""}`} aria-hidden="true"
    style={{ "--avatar-bg": background, "--avatar-fg": color } as CSSProperties}>{initials.toLocaleUpperCase("pt-BR")}</span>;
}
