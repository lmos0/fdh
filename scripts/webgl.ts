import type { Page } from "playwright";

// Sem GPU (Linux da CI), o WebGL do WebKit roda em software e congela a página por segundos,
// como o SwiftShader do Chromium headless. No macOS o WebKit usa a GPU e mantém a mesa 3D.
export const SOFTWARE_WEBGL = process.platform !== "darwin";

/** Sem contexto WebGL o three.js não cria o renderizador e a mesa cai na vista clássica. */
export async function disableSoftwareWebGL(page: Page): Promise<void> {
  if (!SOFTWARE_WEBGL) return;
  await page.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext;
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
      value(this: HTMLCanvasElement, type: string, ...rest: unknown[]) {
        return type.includes("webgl") ? null : Reflect.apply(getContext, this, [type, ...rest]);
      },
    });
  });
}
