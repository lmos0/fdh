import type { Snapshot } from "../../../shared/protocol";

export interface TableCard {
  id: string;
  text: string;
  label: string;
  order?: number;
}
export interface TableModel {
  seats: { name: string; judge?: boolean; winner?: boolean; offline?: boolean }[];
  prompt: string;
  imprint: string;
  cards: TableCard[];
  backs: number;
  canPick: boolean;
  result: boolean;
  caption: string;
}
export const preview: TableModel = {
  seats: [{ name: "Você" }, { name: "Bia", judge: true }, { name: "Zeca" }, { name: "Luna" }],
  prompt: "O que estraga o almoço de domingo?",
  imprint: "CARTA PRETA  /  01",
  cards: ["Um áudio de sete minutos.", "A sinceridade da minha avó.", "O grupo da família."].map((text, i) =>
    ({ id: `demo${i}`, text, label: `RESPOSTA  /  0${i + 1}` })),
  backs: 2, canPick: false, result: false, caption: "Uma pergunta preta. Muitas respostas questionáveis.",
};

/** Recebe apenas a projeção já autorizada para este navegador. O assento local é sempre o primeiro. */
export function tableModel(snapshot: Snapshot, slots: (string | null)[] = [], option: string | null = null,
  locked = false, answers: (string | null)[] = []): TableModel {
  const { room, self } = snapshot;
  const r = room.round;
  const mine = Math.max(0, room.players.findIndex(p => p.id === self.playerId));
  const seats = [...room.players.slice(mine), ...room.players.slice(0, mine)].map(p => ({
    name: p.id === self.playerId ? "Você" : p.nickname, judge: p.id === r?.judgePlayerId,
    winner: p.id === r?.result?.winnerPlayerId, offline: !p.connected,
  }));
  const model: TableModel = { seats, prompt: "Puxe uma cadeira.", imprint: "SALA  /  " + room.code,
    cards: [], backs: 0, canPick: false, result: false, caption: `${seats.length} de 8 lugares ocupados.` };
  if (!r) return model;
  const isJudge = r.judgePlayerId === self.playerId;
  model.imprint = `RODADA  /  ${String(r.number).padStart(2, "0")}`;
  const question = r.prompt.text.replace(/\s*\[(?:DRAW \d+,\s*)?PICK \d+\]\s*$/, "");
  let blank = 0;
  model.prompt = (question.match(/_{2,}/g)?.length === answers.length)
    ? question.replace(/_{2,}/g, () => answers[blank++]?.replace(/\.$/, "") || "_____") : question;
  if (r.result) {
    model.result = true;
    model.cards = r.result.responseTexts.map((text, i) => ({ id: `win${i}`, text, label: `+1  /  CARTA ${i + 1}` }));
    model.caption = `A combinação de ${r.result.winnerNickname} levou o ponto.`;
  } else if (room.phase === "judging") {
    model.cards = r.options.map((o, i) => ({ id: o.id, text: o.responses.join(" / "),
      label: `COMBINAÇÃO  /  ${i + 1}`, order: o.id === option ? 1 : undefined }));
    model.canPick = !locked && !room.paused && isJudge;
    const chosen = r.options.find(o => o.id === option);
    model.caption = chosen ? chosen.responses.join(" / ")
      : isJudge ? "Toque numa combinação para ler. Confirme sua escolha abaixo." : "As combinações estão na mesa. Só o juiz escolhe.";
  } else if (room.phase === "submitting") {
    model.backs = r.receivedCount;
    model.canPick = !locked && !room.paused && !isJudge && !self.submitted;
    if (!isJudge && !self.submitted) {
      model.cards = self.hand.map((c, i) => ({ ...c, label: `SUA MÃO  /  ${i + 1}`, order: slots.indexOf(c.id) + 1 || undefined }));
    }
    model.caption = isJudge || self.submitted ? `${r.receivedCount} de ${r.expectedCount} respostas no centro.`
      : "Toque numa carta da mesa ou escolha na sua mão abaixo.";
    if (model.canPick && answers.some(Boolean)) model.caption = answers.map(a => a || "_____").join(" / ");
  }
  if (room.paused) model.caption = "Mesa pausada.";
  return model;
}
