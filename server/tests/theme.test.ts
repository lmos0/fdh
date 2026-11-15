import { describe, expect, test } from "bun:test";
import { resolveTheme, themePreference } from "../../shared/theme";

describe("preferência de tema", () => {
  test("usa o tema do sistema quando não há preferência salva", () => {
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme(undefined, true)).toBe("dark");
  });

  test("a escolha explícita tem prioridade sobre o sistema", () => {
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  test("ignora valores inválidos no armazenamento", () => {
    for (const value of ["auto", "Dark", "", false, 1, {}, null]) {
      expect(themePreference(value)).toBeNull();
      expect(resolveTheme(value, true)).toBe("dark");
    }
  });
});
