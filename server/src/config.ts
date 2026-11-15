import type { FeatureFlags } from "../../shared/protocol";

export function readFeatureFlags(env: { ENABLE_BOT_TEST_MODE?: string } = {
  ENABLE_BOT_TEST_MODE: process.env.ENABLE_BOT_TEST_MODE,
}): FeatureFlags {
  // Ativação explícita; ausente, false, 1 ou erro de digitação não habilitam o modo.
  return { botTestMode: env.ENABLE_BOT_TEST_MODE?.trim().toLowerCase() === "true" };
}
