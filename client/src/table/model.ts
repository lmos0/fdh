import { MAX_PLAYERS, type Snapshot } from "../../../shared/protocol";

export interface TableCard {
  id: string;
  text: string;
  label: string;
  order?: number;
  /** Cartas na combinação; cartas extras aparecem como uma pilha deslocada sob a primeira. */
  count?: number;
}
/** Ação do monte de respostas na mesa; não colide com IDs de cartas do catálogo. */
export const SWAP_DECK_ACTION = "deck:swap";
/** "ready": tocar no monte ativa a troca. "active": o monte está aberto e a próxima carta tocada é trocada. */
export type TableSwap = "off" | "ready" | "active";

export interface TableModel {
  seats: { name: string; judge?: boolean; winner?: boolean; offline?: boolean }[];
  prompt: string;
  imprint: string;
  cards: TableCard[];
  backs: number;
  canPick: boolean;
  result: boolean;
  /** "hand": cartas em frente ao assento local. "center": cartas jogadas no centro da mesa. */
  zone: "hand" | "center";
  caption: string;
  swap: TableSwap;
}
const SWAP_CAPTIONS = {
  ready: "Toque numa carta para escolher ou no monte de respostas para trocar uma.",
  active: "Monte aberto: toque na carta do suporte que vai voltar para o monte.",
} as const satisfies Record<Exclude<TableSwap, "off">, string>;

export const preview: TableModel = {
  seats: [{ name: "Você" }, { name: "Bia", judge: true }, { name: "Zeca" }, { name: "Luna" }],
  prompt: "O que estraga o almoço de domingo?",
  imprint: "CARTA PRETA  /  01",
  cards: ["Um áudio de sete minutos.", "A sinceridade da minha avó.", "O grupo da família."].map((text, index) =>
    ({ id: `demo${index}`, text, label: `RESPOSTA  /  0${index + 1}` })),
  backs: 2, canPick: false, result: false, zone: "hand", caption: "Uma pergunta. Muitas respostas questionáveis.", swap: "off",
};

/** Recebe apenas a projeção já autorizada para este navegador. O assento local é sempre o primeiro. */
export function tableModel(snapshot: Snapshot, slots: (string | null)[] = [], selectedOptionId: string | null = null,
  locked = false, answers: (string | null)[] = [], swap: TableSwap = "off"): TableModel {
  const { room, self } = snapshot;
  const round = room.round;
  const localIndex = Math.max(0, room.players.findIndex(player => player.id === self.playerId));
  const seats = [...room.players.slice(localIndex), ...room.players.slice(0, localIndex)].map(player => ({
    name: player.id === self.playerId ? "Você" : player.nickname, judge: player.id === round?.judgePlayerId,
    winner: player.id === round?.result?.winnerPlayerId, offline: !player.connected,
  }));
  const model: TableModel = { seats, prompt: "Puxe uma cadeira.", imprint: "SALA  /  " + room.code,
    cards: [], backs: 0, canPick: false, result: false, zone: "hand", caption: `${seats.length} de ${MAX_PLAYERS} lugares ocupados.`, swap: "off" };
  if (!round) return model;
  const isJudge = round.judgePlayerId === self.playerId;
  model.imprint = `RODADA  /  ${String(round.number).padStart(2, "0")}`;
  const question = round.prompt.text.replace(/\s*\[(?:DRAW \d+,\s*)?PICK \d+\]\s*$/, "");
  let blank = 0;
  model.prompt = (question.match(/_{2,}/g)?.length === answers.length)
    ? question.replace(/_{2,}/g, () => answers[blank++]?.replace(/\.$/, "") || "_____") : question;
  if (round.result) {
    model.result = true;
    model.zone = "center";
    model.cards = round.result.responseTexts.map((text, index) => ({ id: `win${index}`, text, label: `+1  /  CARTA ${index + 1}` }));
    model.caption = `A combinação de ${round.result.winnerNickname} levou o ponto.`;
  } else if (room.phase === "judging") {
    model.zone = "center";
    model.cards = round.options.map((option, index) => ({ id: option.id, text: option.responses.join(" / "),
      label: `COMBINAÇÃO  /  ${index + 1}`, order: option.id === selectedOptionId ? 1 : undefined, count: option.responses.length }));
    model.canPick = !locked && !room.paused && isJudge;
    const chosen = round.options.find(option => option.id === selectedOptionId);
    model.caption = chosen ? chosen.responses.join(" / ")
      : isJudge ? "Toque numa combinação para ler. Confirme sua escolha abaixo." : "As combinações estão na mesa. Só o juiz escolhe.";
  } else if (room.phase === "submitting") {
    model.backs = round.receivedCount;
    model.canPick = !locked && !room.paused && !isJudge && !self.submitted;
    // Todos mantêm a mão no suporte; apenas quem ainda vai responder pode escolher cartas dela.
    model.cards = self.hand.map((card, index) => ({ ...card, label: `SUA MÃO  /  ${index + 1}`, order: slots.indexOf(card.id) + 1 || undefined }));
    model.caption = isJudge || self.submitted ? `${round.receivedCount} de ${round.expectedCount} respostas no centro.`
      : "Toque numa carta da mesa ou escolha na sua mão abaixo.";
    model.swap = model.canPick ? swap : "off";
    if (model.swap === "ready") model.caption = SWAP_CAPTIONS.ready;
    if (model.canPick && answers.some(Boolean)) model.caption = answers.map(answer => answer || "_____").join(" / ");
    if (model.swap === "active") model.caption = SWAP_CAPTIONS.active;
  }
  if (room.paused) model.caption = "Mesa pausada.";
  return model;
}
