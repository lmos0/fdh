export type Theme = "light" | "dark";
export const THEME_STORAGE_KEY = "fdh.theme";

export function themePreference(value: unknown): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

export function resolveTheme(preference: unknown, systemDark: boolean): Theme {
  return themePreference(preference) ?? (systemDark ? "dark" : "light");
}
