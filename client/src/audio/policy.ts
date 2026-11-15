import type { SoundName } from "./state";

export const SOUND_PRIORITY: Record<SoundName, number> = {
  select: 1, remove: 1, clear: 1, round: 1,
  submit: 2, judging: 2,
  judge: 3, judge_ready: 3,
  result: 4, point: 4, judge_confirm: 4,
  victory: 5, ending: 5, judge_ending: 5,
};
export const PRIORITY_GAIN: Record<number, number> = { 1: .75, 2: .82, 3: .92, 4: 1, 5: 1.04 };

export function canPlaySound(name: SoundName, activePriorities: readonly number[]): boolean {
  return activePriorities.every(priority => SOUND_PRIORITY[name] >= priority);
}
