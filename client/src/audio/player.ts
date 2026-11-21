import { logger } from "../connection/logger";
import { soundRecipe } from "./recipes";
import { canPlaySound, PRIORITY_GAIN, SOUND_PRIORITY } from "./policy";
import { DEFAULT_SOUND_PREFERENCES, SOUND_STORAGE_KEY, soundPreferences, type SoundName, type SoundPreferences } from "./state";

const MASTER_GAIN = 0.22;
const SELECT_THROTTLE_MS = 55;
const MAX_VOICES = 12;

let preferences = { ...DEFAULT_SOUND_PREFERENCES };
let initialized = false;
let context: AudioContext | null = null;
let output: GainNode | null = null;
let lastSelectAt = -Infinity;
let variation = 0;
let noiseBuffer: AudioBuffer | null = null;
let reportedUnavailable = false;
const listeners = new Set<() => void>();
const voices = new Map<AudioScheduledSourceNode, { envelope: GainNode; filter?: BiquadFilterNode; priority: number; until: number }>();

function stopVoice(source: AudioScheduledSourceNode) {
  const voice = voices.get(source);
  if (!voice) return;
  try { source.stop(); } catch { /* A fonte pode já ter terminado. */ }
  try { source.disconnect(); voice.envelope.disconnect(); voice.filter?.disconnect(); } catch { /* Encerramento já em andamento. */ }
  voices.delete(source);
}

function readPreferences(): SoundPreferences {
  try { return soundPreferences(JSON.parse(localStorage.getItem(SOUND_STORAGE_KEY) ?? "null")); }
  catch { return { ...DEFAULT_SOUND_PREFERENCES }; }
}

export function stopSounds() {
  for (const source of voices.keys()) stopVoice(source);
}

function applyPreferences(next: SoundPreferences) {
  preferences = next;
  if (!next.enabled || next.volume === 0) stopSounds();
  if (context && output) {
    try { output.gain.setTargetAtTime(next.enabled ? next.volume * MASTER_GAIN : 0, context.currentTime, .015); }
    catch { /* Contextos encerrados pelo navegador não devem afetar os controles. */ }
  }
  for (const listener of listeners) listener();
}

export function setSoundPreferences(next: SoundPreferences) {
  applyPreferences(soundPreferences(next));
  try { localStorage.setItem(SOUND_STORAGE_KEY, JSON.stringify(preferences)); }
  catch { /* Continuar em memória se o armazenamento estiver bloqueado. */ }
}

/** Chamar apenas dentro de uma interação: nunca criar AudioContext ao carregar a página. */
export function unlockSound() {
  if (!preferences.enabled || preferences.volume === 0 || document.hidden) return;
  try {
    const AudioContextClass = window.AudioContext ?? (window as Window & {
      webkitAudioContext?: typeof AudioContext;
    }).webkitAudioContext;
    if (!AudioContextClass) return;
    if (!context || context.state === "closed") {
      context = new AudioContextClass();
      noiseBuffer = null;
      output = context.createGain();
      output.gain.value = preferences.volume * MASTER_GAIN;
      output.connect(context.destination);
    }
    if (context.state !== "running") {
      void context.resume().catch(() => { /* Nova interação pode liberar o áudio; não enfileirar sons. */ });
    }
  } catch {
    if (!reportedUnavailable) logger.warn("audio.unavailable", { reason: "browser_or_device" });
    reportedUnavailable = true;
  }
}

export function initializeSound() {
  if (initialized) return;
  initialized = true;
  preferences = readPreferences();
  const onGesture = (event: Event) => { if (event.isTrusted) unlockSound(); };
  document.addEventListener("pointerdown", onGesture, { capture: true, passive: true });
  // Safari/iOS pode liberar áudio apenas no término do toque.
  document.addEventListener("pointerup", onGesture, { capture: true, passive: true });
  document.addEventListener("keydown", onGesture, { capture: true });
  document.addEventListener("visibilitychange", () => { if (document.hidden) stopSounds(); });
  window.addEventListener("pagehide", stopSounds);
  window.addEventListener("storage", event => {
    if (event.key === SOUND_STORAGE_KEY || event.key === null) applyPreferences(readPreferences());
  });
}

export function playSound(name: SoundName, options: { position?: number } = {}): boolean {
  // Nunca tentar reproduzir depois de um await/resume: isso criaria notificações atrasadas.
  if (!preferences.enabled || preferences.volume === 0 || document.hidden || !context || !output || context.state !== "running") return false;
  const now = performance.now();
  for (const [source, voice] of voices) if (voice.until <= context.currentTime) stopVoice(source);
  const priority = SOUND_PRIORITY[name];
  if (!canPlaySound(name, [...voices.values()].map(voice => voice.priority))) return false;
  const local = name === "select" || name === "remove";
  if (local && now - lastSelectAt < SELECT_THROTTLE_MS) return false;
  if (local) lastSelectAt = now;
  // Interações não cortam confirmações; prioridades iguais podem coexistir dentro do teto de vozes.
  for (const [source, voice] of voices) if (voice.priority < priority) stopVoice(source);
  try {
    const recipe = soundRecipe(name, variation++ % 3, options.position);
    if (voices.size + recipe.length > MAX_VOICES) return false;
    const start = context.currentTime + .005;
    for (const tone of recipe) {
      let source: AudioScheduledSourceNode;
      let filter: BiquadFilterNode | undefined;
      const envelope = context.createGain();
      const from = start + tone.at;
      const until = from + tone.duration;
      if (tone.wave === "noise") {
        if (!noiseBuffer) {
          noiseBuffer = context.createBuffer(1, Math.ceil(context.sampleRate * .3), context.sampleRate);
          const data = noiseBuffer.getChannelData(0);
          for (let index = 0; index < data.length; index++) data[index] = Math.random() * 2 - 1;
        }
        const noise = context.createBufferSource();
        noise.buffer = noiseBuffer;
        filter = context.createBiquadFilter();
        filter.type = tone.filter ?? "bandpass";
        filter.frequency.setValueAtTime(tone.frequency, from);
        filter.Q.value = .8;
        noise.connect(filter);
        filter.connect(envelope);
        source = noise;
      } else {
        const oscillator = context.createOscillator();
        oscillator.type = tone.wave;
        oscillator.frequency.setValueAtTime(tone.frequency, from);
        if (tone.endFrequency) oscillator.frequency.exponentialRampToValueAtTime(tone.endFrequency, until);
        oscillator.connect(envelope);
        source = oscillator;
      }
      envelope.gain.setValueAtTime(.0001, from);
      envelope.gain.exponentialRampToValueAtTime(tone.gain * PRIORITY_GAIN[priority]!, from + (tone.attack ?? .005));
      envelope.gain.exponentialRampToValueAtTime(.0001, until);
      envelope.connect(output);
      voices.set(source, { envelope, filter, priority, until: until + .01 });
      source.onended = () => {
        voices.delete(source);
        source.disconnect();
        envelope.disconnect();
        filter?.disconnect();
      };
      source.start(from);
      source.stop(until + .01);
    }
    logger.debug("audio.played", { reason: name });
    return true;
  } catch {
    stopSounds();
    if (!reportedUnavailable) logger.warn("audio.unavailable", { reason: "playback_failed" });
    reportedUnavailable = true;
    return false;
  }
}

export const getSoundPreferences = () => preferences;
export function subscribeSound(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
