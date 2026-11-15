import { useEffect, useRef, useSyncExternalStore } from "react";
import { getSoundPreferences, playSound, setSoundPreferences, subscribeSound, unlockSound } from "../audio/player";

export function SoundControls() {
  const preferences = useSyncExternalStore(subscribeSound, getSoundPreferences);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const muted = !preferences.enabled || preferences.volume === 0;
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && !detailsRef.current?.contains(event.target) && detailsRef.current) {
        detailsRef.current.open = false;
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <details className="sound-controls" ref={detailsRef} onKeyDown={event => {
    if (event.key === "Escape" && detailsRef.current) {
      detailsRef.current.open = false;
      detailsRef.current.querySelector("summary")?.focus();
    }
  }}>
    <summary aria-label="Configurações de som" title={muted ? "Som desligado" : "Som ligado"}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M11 5 6 9H3v6h3l5 4V5Z" />
        {muted ? <path d="m16 9 5 6m0-6-5 6" /> : <><path d="M15 8a6 6 0 0 1 0 8" /><path d="M18 5a10 10 0 0 1 0 14" /></>}
      </svg>
    </summary>
    <div className="sound-popover">
      <button type="button" className="button secondary full" aria-pressed={!preferences.enabled}
        onClick={() => {
          setSoundPreferences({ ...preferences, enabled: !preferences.enabled });
          unlockSound();
        }}>{preferences.enabled ? "Silenciar sons" : "Ativar sons"}</button>
      <label htmlFor="sound-volume">Volume <output>{Math.round(preferences.volume * 100)}%</output></label>
      <input id="sound-volume" type="range" min="0" max="100" step="5" value={Math.round(preferences.volume * 100)}
        aria-valuetext={`${Math.round(preferences.volume * 100)}%`}
        onChange={event => {
          setSoundPreferences({ ...preferences, volume: Number(event.target.value) / 100 });
          unlockSound();
        }} onPointerUp={() => { playSound("select"); }}
        onKeyUp={event => {
          if (event.key.startsWith("Arrow") || ["Home", "End", "PageUp", "PageDown"].includes(event.key)) playSound("select");
        }} />
    </div>
  </details>;
}
