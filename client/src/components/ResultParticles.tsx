import type { CSSProperties } from "react";

export function ResultParticles() {
  return <div className="result-particles" aria-hidden="true">
    {[-90, -65, -38, -15, 15, 38, 65, 90].map((offset, index) => <span key={offset}
      className={index % 2 ? "particle-star" : "particle-card"}
      style={{ "--particle-x": `${offset}px`, "--particle-turn": `${offset * 2}deg`, animationDelay: `${index * 35}ms` } as CSSProperties}>
      {index % 2 ? "✦" : ""}
    </span>)}
  </div>;
}
