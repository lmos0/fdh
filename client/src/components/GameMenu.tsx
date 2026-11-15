import { useEffect, useRef, type ReactNode } from "react";

export function GameMenu({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (event: PointerEvent) => {
      if (event.target instanceof Node && ref.current && !ref.current.contains(event.target)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);
  return <details className="game-menu" ref={ref} onKeyDown={event => {
    if (event.key === "Escape" && ref.current) {
      ref.current.open = false;
      ref.current.querySelector("summary")?.focus();
    }
  }}>
    <summary aria-label="Ações da sala" title="Ações da sala"><span aria-hidden="true">•••</span></summary>
    <div className="game-menu-popover" onClick={event => {
      if (event.target instanceof Element && event.target.closest("button, a") && ref.current) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    }}>{children}</div>
  </details>;
}
