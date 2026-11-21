export const PLAYER_PLACEHOLDER = "{player}";
export const PLAYER_PLACEHOLDER_PATTERN = /\{player\}/g;
export const PLAYER_PLACEHOLDER_LABEL = "(nome de um jogador)";

export function hasPlayerPlaceholder(text: string): boolean {
  return text.includes(PLAYER_PLACEHOLDER);
}

// Une underscores consecutivos com um "word joiner" invisível (U+2060): o apelido aparece igual,
// mas não é confundido com a lacuna `_____` (qualquer sequência de 2+ underscores) da pergunta.
const WORD_JOINER = "⁠";
function escapeBlanks(nickname: string): string {
  return nickname.replace(/_{2,}/g, run => run.split("").join(WORD_JOINER));
}

/** Substitui cada `{player}` em ordem por um apelido da lista, sem repetir enquanto houver nomes disponíveis. */
export function fillPlayerPlaceholders(text: string, nicknames: readonly string[]): string {
  if (!hasPlayerPlaceholder(text) || !nicknames.length) return text;
  let index = 0;
  return text.replace(PLAYER_PLACEHOLDER_PATTERN, () => escapeBlanks(nicknames[index++ % nicknames.length]!));
}

export function formatCatalogPrompt(text: string): string {
  return text.replace(PLAYER_PLACEHOLDER_PATTERN, PLAYER_PLACEHOLDER_LABEL);
}
