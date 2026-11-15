import { describe, expect, test } from "bun:test";
import type { Snapshot } from "../../shared/protocol";
import { createGameSoundTracker, DEFAULT_SOUND_PREFERENCES, soundPreferences } from "../../client/src/audio/state";
import { SOUND_RECIPES, soundRecipe } from "../../client/src/audio/recipes";
import { canPlaySound, PRIORITY_GAIN, SOUND_PRIORITY } from "../../client/src/audio/policy";
import { table } from "./helpers";

function scenario() {
  const h = table();
  const lobby = structuredClone(h.view());
  h.command("c0", "game.start", {});
  const active = structuredClone(h.view());
  // Fixar o papel local sem depender do sorteio para os testes dos sons.
  active.room.round!.judgePlayerId = active.room.players.find(player => player.id !== active.self.playerId)!.id;
  active.room.round!.id = "round-1";
  return { lobby, active };
}

function withResult(active: Snapshot, selfWins = false): Snapshot {
  const next = structuredClone(active);
  next.room.phase = "round_result";
  const winner = next.room.players.find(player => selfWins ? player.id === next.self.playerId : player.id !== next.self.playerId)!;
  next.room.round!.result = {
    roundId: next.room.round!.id, winnerPlayerId: winner.id, winnerNickname: winner.nickname,
    winningOptionId: "option", responseTexts: ["Resposta"], scores: [],
  };
  return next;
}

describe("preferências e efeitos sonoros", () => {
  test("volume padrão moderado e entrada inválida usa valores seguros", () => {
    for (const value of [null, undefined, "invalid", [], 2]) expect(soundPreferences(value)).toEqual(DEFAULT_SOUND_PREFERENCES);
    expect(soundPreferences({ enabled: false, volume: .6 })).toEqual({ enabled: false, volume: .6 });
    expect(soundPreferences({ enabled: "yes", volume: Number.NaN })).toEqual(DEFAULT_SOUND_PREFERENCES);
    expect(soundPreferences({ volume: Infinity })).toEqual(DEFAULT_SOUND_PREFERENCES);
    expect(soundPreferences({ volume: -3 }).volume).toBe(0);
    expect(soundPreferences({ volume: 100 }).volume).toBe(1);
  });

  test("receitas curtas, frequências e ganhos limitados sem arquivos externos", () => {
    expect(Object.keys(SOUND_RECIPES).sort()).toEqual(["clear", "ending", "judge", "judge_confirm", "judge_ending", "judge_ready", "judging", "point", "remove", "result", "round", "select", "submit", "victory"]);
    for (const [name, tones] of Object.entries(SOUND_RECIPES)) {
      expect(tones.length).toBeGreaterThan(0);
      expect(tones.length).toBeLessThanOrEqual(6);
      for (const tone of tones) {
        expect(tone.frequency).toBeGreaterThanOrEqual(100);
        expect(tone.frequency).toBeLessThanOrEqual(2_000);
        expect(tone.gain).toBeGreaterThan(0);
        expect(tone.gain).toBeLessThanOrEqual(.4);
        expect(tone.duration).toBeGreaterThan(.007);
        expect(tone.at + tone.duration).toBeLessThan(name === "victory" ? 2 : 1);
      }
    }
  });

  test("resultado comum, assinatura de ponto e encerramentos têm proporções e inícios distintos", () => {
    expect(SOUND_RECIPES.point.slice(0, 2)).toEqual([...SOUND_RECIPES.result]);
    expect(SOUND_RECIPES.point.slice(2)).toHaveLength(2);
    const length = (name: keyof typeof SOUND_RECIPES) => Math.max(...SOUND_RECIPES[name].map(tone => tone.at + tone.duration));
    expect(length("victory")).toBeGreaterThanOrEqual(1);
    expect(length("victory")).toBeLessThanOrEqual(2);
    expect(length("ending")).toBeLessThan(1);
    expect(length("judge_ending")).toBeLessThan(1);
    expect(SOUND_RECIPES.victory[0]!.frequency).not.toBe(SOUND_RECIPES.result[0]!.frequency);
    expect(SOUND_RECIPES.victory[0]!.frequency).not.toBe(SOUND_RECIPES.ending[0]!.frequency);
  });

  test("hierarquia protege confirmações de interface e preserva celebrações", () => {
    expect(canPlaySound("round", [SOUND_PRIORITY.submit])).toBe(false);
    expect(canPlaySound("select", [SOUND_PRIORITY.submit])).toBe(false);
    expect(canPlaySound("submit", [SOUND_PRIORITY.select])).toBe(true);
    expect(canPlaySound("judge_ready", [SOUND_PRIORITY.submit])).toBe(true);
    expect(canPlaySound("judge_ready", [SOUND_PRIORITY.result])).toBe(false);
    expect(canPlaySound("result", [SOUND_PRIORITY.judge_ready])).toBe(true);
    expect(canPlaySound("result", [SOUND_PRIORITY.victory])).toBe(false);
    expect(canPlaySound("victory", [SOUND_PRIORITY.result])).toBe(true);
    expect(canPlaySound("submit", [SOUND_PRIORITY.submit])).toBe(true);
    expect(PRIORITY_GAIN[1]).toBeLessThan(PRIORITY_GAIN[3]!);
    expect(PRIORITY_GAIN[5]! / PRIORITY_GAIN[4]!).toBeLessThan(1.1);
  });

  test("papel usa ruído filtrado; duas batidas de madeira são exclusivas da chamada pronta", () => {
    expect(SOUND_RECIPES.select.some(tone => tone.wave === "noise")).toBe(true);
    expect(SOUND_RECIPES.remove.every(tone => tone.wave === "noise")).toBe(true);
    expect(SOUND_RECIPES.clear.length).toBeLessThan(3);
    expect(new Set(SOUND_RECIPES.judge_ready.map(tone => tone.at))).toEqual(new Set([0, .15]));
    expect(SOUND_RECIPES.judging.reduce((sum, tone) => sum + tone.gain, 0))
      .toBeLessThan(SOUND_RECIPES.judge_ready.reduce((sum, tone) => sum + tone.gain, 0));
  });

  test("três variações mantêm ganho e significado, com altura crescente para 1ª/2ª/3ª carta", () => {
    const baseline = JSON.stringify(SOUND_RECIPES);
    for (const name of ["select", "remove", "clear", "submit", "round"] as const) {
      const variants = [0, 1, 2].map(variation => soundRecipe(name, variation));
      expect(new Set(variants.map(recipe => JSON.stringify(recipe))).size).toBe(3);
      for (const recipe of variants) {
        expect(recipe.map(tone => tone.gain)).toEqual(SOUND_RECIPES[name].map(tone => tone.gain));
        for (const tone of recipe) {
          expect(tone.duration).toBeLessThan(.3);
          expect(tone.frequency).toBeLessThan(2_000);
        }
      }
    }
    expect(soundRecipe("select", 0, 1)[0]!.frequency).toBeLessThan(soundRecipe("select", 0, 2)[0]!.frequency);
    expect(soundRecipe("select", 0, 2)[0]!.frequency).toBeLessThan(soundRecipe("select", 0, 3)[0]!.frequency);
    expect(JSON.stringify(SOUND_RECIPES)).toBe(baseline);
  });
});

describe("eventos de áudio baseados no estado autoritativo", () => {
  test("primeiro snapshot é silencioso, inclusive ao recuperar uma partida", () => {
    const { lobby, active } = scenario();
    expect(createGameSoundTracker().observe(lobby)).toBeNull();
    expect(createGameSoundTracker().observe(active)).toBeNull();
    expect(createGameSoundTracker().observe(withResult(active))).toBeNull();
  });

  test("início da rodada emite um som sem repetir no mesmo estado", () => {
    const { lobby, active } = scenario();
    const tracker = createGameSoundTracker();
    tracker.observe(lobby);
    expect(tracker.observe(active)).toBe("round");
    expect(tracker.observe(active)).toBeNull();
    const next = structuredClone(active);
    next.room.round!.receivedCount++;
    expect(tracker.observe(next)).toBeNull(); // Respostas dos outros, inclusive bots, são silenciosas.
  });

  test("a chamada de juiz tem prioridade e não toca uma segunda virada de rodada", () => {
    const { lobby, active } = scenario();
    active.room.round!.judgePlayerId = active.self.playerId;
    const tracker = createGameSoundTracker();
    tracker.observe(lobby);
    expect(tracker.observe(active)).toBe("judge");
    expect(tracker.observe(active)).toBeNull();
    const judging = structuredClone(active);
    judging.room.phase = "judging";
    expect(tracker.observe(judging)).toBe("judge_ready");
    expect(tracker.observe(judging)).toBeNull();
  });

  test("quem não é juiz recebe só a transição discreta; respostas individuais continuam silenciosas", () => {
    const { active } = scenario();
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    const judging = structuredClone(active);
    judging.room.phase = "judging";
    expect(tracker.observe(judging)).toBe("judging");
    expect(tracker.observe(judging)).toBeNull();
  });

  test("martelo de confirmação só depois do resultado aceito pelo servidor", () => {
    const { active } = scenario();
    active.room.phase = "judging";
    active.room.round!.judgePlayerId = active.self.playerId;
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    expect(tracker.observe(active)).toBeNull(); // Cliques/rejeições sem novo resultado não confirmam nada.
    const result = withResult(active);
    expect(tracker.observe(result)).toBe("judge_confirm");
    expect(tracker.observe(result)).toBeNull();
  });

  test("juiz no encerramento recebe composição curta de martelo e final, sem vinheta de campeão", () => {
    const { active } = scenario();
    active.room.phase = "judging";
    active.room.round!.judgePlayerId = active.self.playerId;
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    const result = withResult(active);
    result.room.phase = "finished";
    result.room.finishReason = "target_reached";
    result.room.winnerPlayerId = result.room.round!.result!.winnerPlayerId;
    expect(tracker.observe(result)).toBe("judge_ending");
    expect(tracker.observe(result)).toBeNull();
  });

  test("julgamento já observado durante pausa não dispara chamada atrasada na retomada", () => {
    const { active } = scenario();
    active.room.round!.judgePlayerId = active.self.playerId;
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    const paused = structuredClone(active);
    paused.room.phase = "judging";
    paused.room.paused = true;
    expect(tracker.observe(paused)).toBeNull();
    paused.room.paused = false;
    expect(tracker.observe(paused)).toBeNull();
  });

  test("ganhar um ponto tem celebração própria e reconexão no julgamento não repete chamada", () => {
    const { active } = scenario();
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    expect(tracker.observe(withResult(active, true))).toBe("point");
    tracker.resync();
    active.room.phase = "judging";
    active.room.round!.judgePlayerId = active.self.playerId;
    expect(tracker.observe(active)).toBeNull();
    expect(tracker.observe(active)).toBeNull();
  });

  test("confirma envio somente quando o snapshot contém a própria resposta", () => {
    const { active } = scenario();
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    const submitted = structuredClone(active);
    submitted.self.submitted = true;
    // Último envio pode mudar a fase diretamente para julgamento.
    submitted.room.phase = "judging";
    expect(tracker.observe(submitted)).toBe("submit");
    expect(tracker.observe(submitted)).toBeNull();
  });

  test("resultado vem do snapshot e só é anunciado uma vez", () => {
    const { active } = scenario();
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    const result = withResult(active);
    expect(tracker.observe(result)).toBe("result");
    expect(tracker.observe(result)).toBeNull();
  });

  test("vencedor recebe celebração em vez do resultado comum", () => {
    const { active } = scenario();
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    const result = withResult(active, true);
    result.room.phase = "finished";
    result.room.finishReason = "target_reached";
    result.room.winnerPlayerId = active.self.playerId;
    expect(tracker.observe(result)).toBe("victory");
    expect(tracker.observe(result)).toBeNull();
  });

  test("demais participantes recebem encerramento curto, não vinheta de campeão", () => {
    const { active } = scenario();
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    const result = withResult(active);
    result.room.phase = "finished";
    result.room.finishReason = "target_reached";
    result.room.winnerPlayerId = result.room.round!.result!.winnerPlayerId;
    expect(tracker.observe(result)).toBe("ending");
  });

  test("reconexão silencia o estado recuperado e continua nas rodadas seguintes", () => {
    const { active } = scenario();
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    tracker.resync();
    const resumed = withResult(active);
    expect(tracker.observe(resumed)).toBeNull();
    const next = structuredClone(active);
    next.room.round!.id = "round-2";
    next.room.round!.judgePlayerId = next.self.playerId;
    expect(tracker.observe(next)).toBe("judge");
  });

  test("não produz avisos atrasados quando um snapshot já foi consumido em silêncio", () => {
    const { active } = scenario();
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    const result = withResult(active);
    tracker.observe(result); // O player pode descartá-lo por mute, aba oculta ou autoplay bloqueado.
    expect(tracker.observe(result)).toBeNull();
    const paused = structuredClone(active);
    paused.room.round!.id = "round-paused";
    paused.room.paused = true;
    expect(tracker.observe(paused)).toBeNull();
    paused.room.paused = false;
    expect(tracker.observe(paused)).toBeNull();
  });

  test("troca de sala/identidade e encerramento sem vencedor não geram celebração", () => {
    const { active } = scenario();
    const tracker = createGameSoundTracker();
    tracker.observe(active);
    const next = structuredClone(active);
    next.room.code = "OTHER2";
    next.room.round!.id = "different";
    expect(tracker.observe(next)).toBeNull();
    next.self.playerId = "different-player";
    expect(tracker.observe(next)).toBeNull();
    next.room.phase = "finished";
    next.room.finishReason = "not_enough_players";
    next.room.round = null;
    expect(tracker.observe(next)).toBeNull();
  });
});
