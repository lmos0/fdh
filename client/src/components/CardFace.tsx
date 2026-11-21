export function CardFace({ className = "", mischievous = false, expression }: {
  className?: string; mischievous?: boolean;
  expression?: "curious" | "thinking" | "suspicious" | "mischievous" | "sleepy";
}) {
  const mood = expression ?? (mischievous ? "mischievous" : "curious");
  return <svg className={`card-face ${className}`} width="28" height="28" viewBox="0 0 32 32"
    fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
    aria-hidden="true" focusable="false">
    {mood === "mischievous" ? <><path d="m9 7-1-4 5 3m10 1 1-4-5 3" /><path d="m10 13 3 1m9-1-3 1" /></>
      : mood === "sleepy" ? <><path d="m9 14 4 1m6 0 4-1M23 3h5l-4 4h5" /></>
      : mood === "suspicious" ? <><path d="m9 11 5 2m9-2-5 2M11 15h1m8 0h1" /></>
      : <><ellipse cx="11.5" cy="13.5" rx="1" ry="1.5" fill="currentColor" stroke="none" /><ellipse cx="20.5" cy="13.5" rx="1" ry="1.5" fill="currentColor" stroke="none" />
        {mood === "thinking" ? <path d="m9 10 4-1m6 1h4" /> : <path d="m18 9 4-1" />}</>}
    <rect x="5" y="6" width="22" height="23" rx="7" />
    <path d={mood === "mischievous" ? "M11 20q5 4 11-2" : mood === "thinking" ? "M13 22q3-2 6-1" : mood === "sleepy" ? "M14 21h4" : mood === "suspicious" ? "m13 22 6-1" : "M12 20q4 4 8 0"} />
    <path d="M8 18h2m12 0h2" strokeOpacity=".4" />
    {mood === "suspicious" && <path d="m23 25 5-5m-2-2 4 4m-6-2 4 4M23 29h7" strokeWidth="2.3" />}
  </svg>;
}
