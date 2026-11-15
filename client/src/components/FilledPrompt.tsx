import { Fragment } from "react";

// O marcador [PICK n] é redundante na partida: a quantidade aparece no rodapé da pergunta.
const MARKER = /\s*\[(?:DRAW \d+,\s*)?PICK \d+\]\s*$/;
const BLANK = /_{2,}/;

/** Só preenche quando a pergunta tem exatamente uma lacuna por carta. */
export function fillsInline(text: string, count: number) {
  return count > 0 && text.replace(MARKER, "").split(BLANK).length - 1 === count;
}

/** Pergunta com as lacunas preenchidas, em ordem, pelas cartas escolhidas. */
export function FilledPrompt({ text, answers = [] }: { text: string; answers?: (string | null)[] }) {
  const parts = text.replace(MARKER, "").split(BLANK);
  const inline = fillsInline(text, answers.length);
  return <>{parts.map((part, index) => {
    const answer = inline ? answers[index] : null;
    return <Fragment key={index}>{part}{index < parts.length - 1 && (answer
      ? <mark className="prompt-fill">{answer.replace(/\.$/, "")}</mark>
      : <span className="prompt-blank">_____</span>)}</Fragment>;
  })}</>;
}
