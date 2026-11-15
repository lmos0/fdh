import { resolveTheme, themePreference, THEME_STORAGE_KEY, type Theme } from "../../shared/theme";

let preference: Theme | null = null;
let current: Theme = "light";
let initialized = false;
const listeners = new Set<() => void>();

function apply(theme: Theme) {
  current = theme;
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#151219" : "#f5eef2");
  for (const listener of listeners) listener();
}

export function initializeTheme() {
  if (initialized) return;
  initialized = true;
  try { preference = themePreference(localStorage.getItem(THEME_STORAGE_KEY)); }
  catch { /* A escolha continua funcionando em memória se o armazenamento estiver bloqueado. */ }
  const system = matchMedia("(prefers-color-scheme: dark)");
  apply(resolveTheme(preference, system.matches));
  system.addEventListener("change", event => {
    if (!preference) apply(resolveTheme(null, event.matches));
  });
  window.addEventListener("storage", event => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    preference = themePreference(event.newValue);
    apply(resolveTheme(preference, system.matches));
  });
}

export function setTheme(theme: Theme) {
  preference = theme;
  apply(theme);
  try { localStorage.setItem(THEME_STORAGE_KEY, theme); }
  catch { /* Não impedir a troca de tema no modo privado. */ }
}

export const getTheme = () => current;
export function subscribeTheme(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
