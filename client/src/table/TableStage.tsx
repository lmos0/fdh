import { useEffect, useRef, useState } from "react";
import type { TableModel } from "./model";
import type { mountTable } from "./scene";
import "./table.css";

type Engine = ReturnType<typeof mountTable>;

export function TableStage({ model, pick, title = "Mesa da rodada", preview = false }: {
  model: TableModel; pick?: (id: string) => void; title?: string; preview?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const engine = useRef<Engine | null>(null);
  const latest = useRef({ model, pick });
  const [status, setStatus] = useState<"loading" | "ready" | "fallback">("loading");
  const [overhead, setOverhead] = useState(false);
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
      engine.current = mountTable(target, id => latest.current.pick?.(id), () => { if (active) setStatus(s => s === "loading" ? "ready" : s); });
      engine.current.update(latest.current.model);
    }).catch(fallback);
    return () => {
      active = false; target.removeEventListener("webglcontextlost", fallback);
      engine.current?.dispose(); engine.current = null;
    };
  }, []);
  useEffect(() => { engine.current?.setOverhead(overhead); }, [overhead]);

  return <section className={`table-stage ${preview ? "stage-preview" : ""} stage-${status}`} aria-label="Visualização da mesa">
    <div className="stage-heading"><span><i aria-hidden="true" /> {title}</span>
      <small>{status === "fallback" ? "VISTA CLÁSSICA" : "EDIÇÃO 3D"}</small></div>
    <div className="stage-view">
      <canvas ref={canvas} aria-hidden="true" />
      {status !== "ready" && <div className="stage-poster" aria-hidden="true"><span>FDH</span><b>?</b><span>!</span></div>}
    </div>
    <div className="stage-foot"><span>{status === "fallback" && !preview ? "Continue pelos controles de cartas." : model.caption}</span>
      {status === "ready" && <button type="button" className="camera-switch" aria-label="Vista de cima"
        aria-pressed={overhead} onClick={() => setOverhead(v => !v)}>
        <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M3 8h4l2-3h6l2 3h4v12H3z"/><circle cx="12" cy="13" r="3.5"/>
        </svg>{overhead ? "De cima" : "Do assento"}</button>}
    </div>
  </section>;
}
