import { GAME_NAME } from "../../../shared/branding";
import { CardFace } from "./CardFace";

export function Brand({ compact = false }: { compact?: boolean }) {
  return <a className={`logo ${compact ? "compact-brand" : ""}`} href="/" aria-label={`${GAME_NAME}, início`}>
    <span className="brand-mark"><CardFace mischievous /></span>
    {compact ? <span className="brand-name" aria-hidden="true">FDH</span> : <span className="brand-name">Ferindo Direitos Humanos<span className="brand-friends">com amigos</span></span>}
  </a>;
}
