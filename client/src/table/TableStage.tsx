import { useEffect, useRef, useState } from "react";
import type { TableModel } from "./model";
import type { mountTable } from "./scene";
import "./table.css";

type Engine = ReturnType<typeof mountTable>;

// Mirrors MAX_ZOOM in scene.ts; importing it from there would pull three.js into the main bundle.
const MAX_ZOOM = 3.5;
const STEP = 1.5;
const MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

export function TableStage({ model, pick, title = "Mesa da rodada", preview = false }: {
  model: TableModel; pick?: (id: string) => void; title?: string; preview?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const latest = useRef({ model, pick });
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [overhead, setOverhead] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [hint, setHint] = useState<string | null>(null);
  const hintTimer = useRef(0);
  const taught = useRef(false);

  function showHint(text: string) {
    setHint(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setHint(null), 1800);
  }

  useEffect(() => {
    latest.current = { model, pick };
    engine.current?.update(model);
  }, [model, pick]);
  useEffect(() => {
    let active = true;
    const target = canvas.current!;
    function fallback() { if (active) setStatus("fallback"); }
    target.addEventListener("webglcontextlost", fallback);
    void import("./scene").then(({ mountTable }) => {
      if (!active) return;
      engine.current = mountTable(target, id => latest.current.pick?.(id),
        () => { if (active) setStatus(s => s === "loading" ? "ready" : s); }, {
          zoomable: !preview,
          onZoom: value => {
            if (!active) return;
            setZoom(value);
            // The first time the view is zoomed in, say how to look around.
            if (value > 1.001 && !taught.current) showHint("Arraste para mover a vista");
            taught.current ||= value > 1.001;
          },
          onWheelHint: () => { if (active) showHint(`${MAC ? "⌘" : "Ctrl"} + rolagem ou pinça para dar zoom`); },
        });
      engine.current.update(latest.current.model);
    }).catch(fallback);
    return () => {
      active = false; target.removeEventListener("webglcontextlost", fallback);
      clearTimeout(hintTimer.current);
      engine.current?.dispose(); engine.current = null;
    };
  }, []);
  useEffect(() => { engine.current?.setOverhead(overhead); }, [overhead]);

  const ready = status === "ready";
  return <section className={`table-stage ${preview ? "stage-preview" : ""} stage-${status}`} aria-label="Visualização da mesa">
    <div className="stage-heading"><span><i aria-hidden="true" /> {title}</span>
      <small>{status === "fallback" ? "VISTA CLÁSSICA" : "EDIÇÃO 3D"}</small></div>
    <div className="stage-view">
      <canvas ref={canvas} aria-hidden="true" />
      {status !== "ready" && <div className="stage-poster" aria-hidden="true"><span>FDH</span><b>?</b><span>!</span></div>}
      {ready && !preview && <div className="stage-zoom" role="group" aria-label="Zoom da mesa">
        <button type="button" aria-label="Afastar" title="Afastar" disabled={zoom <= 1.001}
          onClick={() => engine.current?.zoomBy(1 / STEP)}>−</button>
        <button type="button" aria-label="Aproximar" title="Aproximar" disabled={zoom >= MAX_ZOOM - 0.001}
          onClick={() => engine.current?.zoomBy(STEP)}>+</button>
        {zoom > 1.001 && <button type="button" aria-label="Ver a mesa inteira" title="Ver a mesa inteira"
          onClick={() => engine.current?.resetZoom()}>
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
            <path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
          </svg></button>}
      </div>}
      {hint && ready && <div className="stage-hint" aria-hidden="true">{hint}</div>}
    </div>
    <div className="stage-foot"><span>{status === "fallback" && !preview ? "Continue pelos controles de cartas." : model.caption}</span>
      {ready && <button type="button" className="camera-switch" aria-label="Vista de cima"
        aria-pressed={overhead} onClick={() => setOverhead(v => !v)}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3.5"/>
        </svg>{overhead ? "De cima" : "Do assento"}</button>}
    </div>
  </section>;
}
