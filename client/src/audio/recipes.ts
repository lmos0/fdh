import type { SoundName } from "./state";

export interface SoundTone {
  frequency: number;
  endFrequency?: number;
  at: number;
  duration: number;
  gain: number;
  wave: "sine" | "triangle" | "noise";
  filter?: "bandpass" | "highpass" | "lowpass";
  attack?: number;
}

// Papel = ruído filtrado; madeira = impacto com corpo tonal; celebração = notas curtas.
// Todas as camadas compartilham o mesmo ganho mestre. Sem arquivos ou tráfego de áudio.
const paper = (at: number, duration: number, frequency: number, gain: number): SoundTone =>
  ({ wave: "noise", filter: "bandpass", frequency, at, duration, gain, attack: .004 });
const wood = (at: number): SoundTone[] => [
  { wave: "triangle", frequency: 280, endFrequency: 145, at, duration: .075, gain: .23, attack: .003 },
  { wave: "noise", filter: "lowpass", frequency: 850, at, duration: .035, gain: .16, attack: .003 },
];
const reveal: SoundTone[] = [
  { wave: "triangle", frequency: 523.25, at: 0, duration: .1, gain: .2 },
  { wave: "sine", frequency: 659.25, at: .09, duration: .15, gain: .18 },
];
const ending: SoundTone[] = [
  { wave: "triangle", frequency: 392, at: 0, duration: .1, gain: .21 },
  { wave: "sine", frequency: 523.25, at: .1, duration: .1, gain: .2 },
  { wave: "triangle", frequency: 659.25, at: .2, duration: .12, gain: .18 },
  { wave: "sine", frequency: 523.25, at: .31, duration: .2, gain: .17 },
];

export const SOUND_RECIPES: Record<SoundName, readonly SoundTone[]> = {
  select: [paper(0, .055, 1_500, .22),
    { wave: "triangle", frequency: 780, endFrequency: 540, at: .008, duration: .035, gain: .1 }],
  remove: [paper(0, .105, 1_100, .2)],
  clear: [paper(0, .16, 950, .21), paper(.025, .09, 1_450, .1)],
  submit: [paper(0, .08, 1_200, .22),
    { wave: "triangle", frequency: 240, endFrequency: 140, at: .025, duration: .065, gain: .18 },
    { wave: "sine", frequency: 740, at: .105, duration: .085, gain: .16 }],
  round: [paper(0, .07, 1_200, .18), paper(.045, .065, 1_450, .16), paper(.085, .06, 1_650, .14)],
  judge: wood(0),
  judge_ready: [...wood(0), ...wood(.15)],
  judging: [paper(0, .065, 1_000, .1)],
  judge_confirm: [...wood(0),
    { wave: "sine", frequency: 523.25, at: .09, duration: .09, gain: .18 },
    { wave: "triangle", frequency: 659.25, at: .18, duration: .13, gain: .16 }],
  result: reveal,
  point: [
    ...reveal,
    { wave: "triangle", frequency: 880, at: .23, duration: .085, gain: .2 },
    { wave: "sine", frequency: 783.99, at: .31, duration: .13, gain: .19 },
  ],
  ending,
  judge_ending: [...wood(0), ...ending.map(tone => ({ ...tone, at: tone.at + .09 }))],
  victory: [
    { wave: "triangle", frequency: 783.99, at: 0, duration: .15, gain: .26 },
    { wave: "sine", frequency: 1_046.5, at: .13, duration: .16, gain: .24 },
    { wave: "triangle", frequency: 987.77, at: .3, duration: .12, gain: .22 },
    { wave: "sine", frequency: 880, at: .47, duration: .16, gain: .22 },
    { wave: "triangle", frequency: 1_046.5, at: .72, duration: .2, gain: .24 },
    { wave: "sine", frequency: 1_318.51, at: 1.02, duration: .35, gain: .22 },
  ],
};

export function soundRecipe(name: SoundName, variation = 0, position = 1): readonly SoundTone[] {
  if (!["select", "remove", "clear", "submit", "round"].includes(name)) return SOUND_RECIPES[name];
  const variant = [0, 1, 2].includes(variation) ? variation : 0;
  const slot = Number.isFinite(position) ? Math.max(1, Math.min(3, position)) : 1;
  const pitch = [1, 1.015, .985][variant]! * (name === "select" ? 2 ** ((slot - 1) * 1.5 / 12) : 1);
  const length = [1, .97, 1.03][variant]!;
  return SOUND_RECIPES[name].map(tone => ({ ...tone, frequency: tone.frequency * pitch,
    endFrequency: tone.endFrequency === undefined ? undefined : tone.endFrequency * pitch, duration: tone.duration * length }));
}
