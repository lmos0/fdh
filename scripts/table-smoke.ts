import assert from "node:assert/strict";
import { chromium, type Page } from "playwright";
import { loadCatalog } from "../server/src/cards";
import { startServer } from "../server/src/connections";
import { createLogger } from "../shared/logging";

// Real pointer picking against a real canvas. No internal scene handles exposed to tests.
async function pickFromTable(page: Page) {
  const canvas = page.locator(".stage-ready canvas");
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  assert(box);
  for (const row of [.64, .60, .67, .56]) {
    for (let col = .18; col <= .83; col += .035) {
      const x = box.x + box.width * col, y = box.y + box.height * row;
      await page.mouse.move(x, y);
      if (await canvas.evaluate(c => c.style.cursor !== "pointer")) continue;
      await page.mouse.click(x, y);
      return;
    }
  }
  throw new Error("Nenhuma carta selecionável encontrada na mesa.");
}

const catalog = await loadCatalog();
const app = startServer({ catalog: { ...catalog, promptIds: ["p17"] }, port: 0, hostname: "127.0.0.1",
  logger: createLogger({ level: "silent" }), botTestModeEnabled: true });
try {
  const browser = await chromium.launch({ args: ["--enable-unsafe-swiftshader"] });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: "reduce" });
    const errors: string[] = [];
    page.on("pageerror", e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${app.server.port}`);
    await page.locator(".stage-ready").waitFor();
    await page.getByLabel("Seu apelido").fill("Mesa de teste");
    await page.getByRole("button", { name: "Testar com 2 bots" }).click();
    await page.getByLabel("Tempo por fase", { exact: true }).selectOption("none");
    await page.getByLabel("Tempo para apreciar o resultado").selectOption("manual");
    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await page.getByRole("button", { name: "Começar a partida" }).click();
    await page.getByRole("heading", { name: "Escolha a vencedora" }).waitFor();
    const camera = page.getByRole("button", { name: "Vista de cima" });
    await camera.click();
    assert.equal(await camera.getAttribute("aria-pressed"), "true");
    await pickFromTable(page);
    await page.locator(".answer-group.selected").waitFor();
    await page.getByRole("button", { name: "Escolher vencedora" }).click();
    await page.locator(".round-result").waitFor();
    await page.getByRole("button", { name: "Próxima rodada" }).click();
    await page.getByRole("heading", { name: "Sua mão" }).waitFor();
    await camera.click();
    await pickFromTable(page);
    await page.locator(".hand-grid .answer-card.selected").waitFor();
    const text = await page.locator(".slot-text").first().textContent();
    assert(text && (await page.locator(".stage-foot").textContent())?.includes(text));
    await page.locator(".stage-ready canvas").evaluate((c: HTMLCanvasElement) => {
      c.getContext("webgl2")!.getExtension("WEBGL_lose_context")!.loseContext();
    });
    await page.locator(".stage-fallback").waitFor();
    assert.equal(await page.locator(".slot-text").first().textContent(), text);
    await page.getByRole("button", { name: "Enviar resposta" }).click();
    await page.getByRole("heading", { name: "Julgamento", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.info("Mesa 3D OK: seleção de combinação e carta por raycast, câmeras, resultado e envio após perda de WebGL.");
  } finally { await browser.close(); }
} finally { await app.stop(); }
