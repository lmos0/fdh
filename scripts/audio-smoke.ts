import assert from "node:assert/strict";
import { chromium, webkit, type Browser, type Page } from "playwright";
import { loadCatalog } from "../server/src/cards";
import { startServer } from "../server/src/connections";
import { createLogger } from "../shared/logging";

// Instrumentação somente no teste: conta nós Web Audio reais e observa logs sem payloads.
interface AudioProbe { contexts: number; starts: number; noiseStarts: number; filters: number; failedStarts: number; failPlayback: boolean; states: string[] }
type ProbedWindow = Window & { __audioProbe?: AudioProbe };
const catalog = await loadCatalog();
const app = startServer({ catalog: { ...catalog, promptIds: ["p89"] }, port: 0, hostname: "127.0.0.1",
  logger: createLogger({ level: "silent" }), botTestModeEnabled: true });
const origin = `http://127.0.0.1:${app.server.port}`;
const pageErrors: string[] = [];

async function probe(page: Page) {
  return page.evaluate(() => ({ ...(window as ProbedWindow).__audioProbe! }));
}

async function setup(page: Page) {
  page.setDefaultTimeout(12_000);
  page.on("pageerror", error => pageErrors.push(error.name));
  await page.addInitScript(() => {
    try { localStorage.setItem("fdh.logLevel", "debug"); } catch { /* Teste sem armazenamento. */ }
    const stats: AudioProbe = { contexts: 0, starts: 0, noiseStarts: 0, filters: 0, failedStarts: 0, failPlayback: false, states: [] };
    (window as ProbedWindow).__audioProbe = stats;
    const NativeAudioContext = window.AudioContext;
    if (!NativeAudioContext) return;
    window.AudioContext = new Proxy(NativeAudioContext, {
      construct(target, args) {
        const context = Reflect.construct(target, args) as AudioContext;
        stats.contexts++;
        stats.states.push(context.state);
        context.addEventListener("statechange", () => stats.states.push(context.state));
        const create = context.createOscillator.bind(context);
        context.createOscillator = () => {
          const oscillator = create();
          const start = oscillator.start.bind(oscillator);
          oscillator.start = (when?: number) => {
            if (stats.failPlayback) { stats.failedStarts++; throw new Error("Falha simulada de áudio"); }
            stats.starts++;
            start(when);
          };
          return oscillator;
        };
        const createNoise = context.createBufferSource.bind(context);
        context.createBufferSource = () => {
          const source = createNoise();
          const start = source.start.bind(source);
          source.start = (when?: number, offset?: number, duration?: number) => {
            if (stats.failPlayback) { stats.failedStarts++; throw new Error("Falha simulada de áudio"); }
            stats.starts++; stats.noiseStarts++;
            start(when, offset, duration);
          };
          return source;
        };
        const createFilter = context.createBiquadFilter.bind(context);
        context.createBiquadFilter = () => { stats.filters++; return createFilter(); };
        return context;
      },
    });
  });
}

async function openSound(page: Page) {
  const summary = page.locator(".sound-controls > summary");
  await summary.tap();
  await page.getByLabel("Volume", { exact: false }).waitFor();
}

async function closeSound(page: Page) {
  if (await page.locator(".sound-controls").getAttribute("open") !== null) await page.locator(".sound-controls > summary").tap();
}

async function audioFlow(browser: Browser, name: string) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await setup(page);
  const played: string[] = [];
  page.on("console", message => {
    try {
      const record = JSON.parse(message.text()) as { event?: string; reason?: string };
      if (record.event === "audio.played" && record.reason) played.push(record.reason);
    } catch { /* Outros logs não interessam ao teste. */ }
  });
  // Repetir snapshots reais testa a deduplicação sem modificar as regras ou os dados recebidos.
  await page.routeWebSocket("**/ws", socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      socket.send(message);
      if (typeof message === "string" && JSON.parse(message).type === "state.snapshot") socket.send(message);
    });
  });
  try {
    await page.goto(origin);
    await page.getByText("Conectado", { exact: true }).waitFor();
    assert((await probe(page)).contexts === 0 && (await probe(page)).starts === 0, "Áudio foi criado antes da primeira interação");
    await openSound(page);
    const volume = page.getByLabel("Volume", { exact: false });
    assert(await volume.inputValue() === "35", "Volume padrão não é moderado");
    await volume.press("End");
    // O primeiro resume do WebKit pode concluir depois do keyup; não esperar som enfileirado.
    await page.waitForFunction(() => (window as ProbedWindow).__audioProbe!.states.at(-1) === "running");
    await volume.press("ArrowLeft");
    await volume.press("End");
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("fdh.audio") ?? "null")?.volume === 1);
    assert((await probe(page)).contexts === 1, "Mais de um contexto foi criado");
    assert((await probe(page)).starts > 0, `Web Audio não iniciou após interação: ${JSON.stringify(await probe(page))}`);
    await page.getByRole("button", { name: "Silenciar sons", exact: true }).tap();
    await closeSound(page);
    await page.reload();
    await page.getByText("Conectado", { exact: true }).waitFor();
    await openSound(page);
    await page.getByRole("button", { name: "Ativar sons", exact: true }).waitFor();
    assert(await page.getByLabel("Volume", { exact: false }).inputValue() === "100", "Volume não persistiu");
    assert((await probe(page)).contexts === 0, "Mute permitiu criar contexto");
    await page.getByRole("button", { name: "Ativar sons", exact: true }).tap();
    await page.getByLabel("Volume", { exact: false }).press("Home");
    const startsAtZero = (await probe(page)).starts;
    await page.getByLabel("Volume", { exact: false }).press("ArrowLeft");
    assert((await probe(page)).starts === startsAtZero, "Volume zero não silenciou o preview");
    await page.getByLabel("Volume", { exact: false }).press("ArrowRight");
    await closeSound(page);

    await page.getByLabel("Seu apelido").fill("Teste sonoro");
    await page.getByRole("button", { name: "Testar com 2 bots", exact: true }).tap();
    await page.getByRole("heading", { name: "Sala de espera", exact: true }).waitFor();
    await page.getByLabel("Tempo para apreciar o resultado").selectOption("5");
    await page.getByRole("button", { name: "Salvar", exact: true }).tap();
    await page.waitForFunction(() => (document.querySelector(".settings-form button") as HTMLButtonElement)?.disabled);
    played.length = 0;
    await page.getByRole("button", { name: "Começar a partida", exact: true }).tap();
    await page.getByRole("status", { name: "Juiz da rodada", exact: true }).waitFor();
    assert(played.filter(sound => sound === "judge").length === 1, "Chamada de juiz ausente ou duplicada");
    assert(!played.includes("round"), "Juiz recebeu dois sons na troca de rodada");
    await page.getByRole("heading", { name: "Julgamento", exact: true }).waitFor();
    assert(played.filter(sound => sound === "judge_ready").length === 1, "Duas batidas de julgamento pronto ausentes ou repetidas");
    assert(played.length === 2, "Respostas individuais dos bots geraram sons locais indevidos");
    await page.reload();
    await page.getByText("Conectado", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Julgamento", exact: true }).waitFor();
    assert((await probe(page)).contexts === 0, "Reconexão tentou liberar autoplay");
    assert(played.length === 2, "Reconexão repetiu a chamada de juiz");

    await page.locator(".answer-group").first().tap();
    await page.waitForFunction(() => (window as ProbedWindow).__audioProbe!.states.at(-1) === "running");
    // Em iOS, o primeiro toque após reload também pode servir só para desbloquear o contexto.
    if (played.at(-1) !== "select") await page.locator(".answer-group").nth(1).tap();
    assert(played.at(-1) === "select", "Seleção do juiz não emitiu clique local");
    await page.getByRole("button", { name: "Escolher vencedora", exact: true }).tap();
    await page.locator(".round-result").waitFor();
    assert(played.filter(sound => sound === "judge_confirm").length === 1, "Martelo de confirmação ausente ou repetido pelo snapshot duplicado");
    assert(await page.locator(".round-result.is-revealing").count() === 1, "Resultado novo não iniciou revelação visual");
    await page.getByRole("heading", { name: "Respostas", exact: true }).waitFor();
    assert(played.filter(sound => sound === "round").length === 1, "Troca de rodada não tocou");

    await openSound(page);
    await page.getByRole("button", { name: "Silenciar sons", exact: true }).tap();
    await closeSound(page);
    const mutedStarts = (await probe(page)).starts;
    await page.locator(".answer-card").nth(0).tap();
    assert((await probe(page)).starts === mutedStarts, "Carta emitiu som durante mute");
    assert(await page.locator(".answer-card.selected").count() === 1, "Mute alterou a seleção");
    await openSound(page);
    await page.getByRole("button", { name: "Ativar sons", exact: true }).tap();
    await closeSound(page);
    await page.locator(".answer-card").nth(1).tap();
    await page.locator(".answer-card").nth(2).tap();
    await page.locator(".answer-card").nth(2).tap();
    assert(played.at(-1) === "remove", "Remover carta não teve deslize próprio");
    const clears = played.filter(sound => sound === "clear").length;
    await page.getByRole("button", { name: "Limpar seleção", exact: true }).tap();
    assert(played.filter(sound => sound === "clear").length === clears + 1, "Limpar deve produzir um único som de recolher");
    for (const index of [0, 1, 2]) await page.locator(".answer-card").nth(index).tap();
    await page.getByRole("button", { name: "Enviar resposta", exact: true }).tap();
    await page.locator(".submitted-card, #judging-heading").first().waitFor();
    assert(played.filter(sound => sound === "submit").length === 1, "Envio aceito não teve confirmação única");
    assert((await probe(page)).noiseStarts > 0 && (await probe(page)).filters > 0, "Texturas não usaram ruído e filtros Web Audio reais");
    assert(played.filter(sound => sound === "judge_ready").length === 1, "Não juiz recebeu chamada exclusiva do juiz");

    const beforeHidden = played.length;
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await page.locator(".round-result").waitFor();
    assert(played.length === beforeHidden, "Aba oculta emitiu som");
    assert(await page.locator(".round-result.is-revealing").count() === 0, "Aba oculta iniciou celebração visual");
    await page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => false });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    assert(played.length === beforeHidden, "Voltar à aba reproduziu áudio atrasado");
    // Uma falha do dispositivo não pode impedir selecionar/enviar cartas na rodada seguinte.
    await page.getByRole("heading", { name: "Respostas", exact: true }).waitFor();
    await page.evaluate(() => { (window as ProbedWindow).__audioProbe!.failPlayback = true; });
    await page.locator(".answer-card").first().tap();
    assert(await page.locator(".answer-card.selected").count() === 1, "Falha de áudio interrompeu a UI");
    assert((await probe(page)).failedStarts >= 1, "Caminho de falha do player não foi exercitado");
    console.info(`${name}: desbloqueio por toque, volume/mute persistidos, seleção, juiz, rodada, envio, resultado, replay, reconexão, aba oculta e falha de áudio OK.`);
  } finally {
    await context.close();
  }
}

async function unavailableAudio(browser: Browser, name: string) {
  const context = await browser.newContext({ viewport: { width: 320, height: 568 }, hasTouch: true, isMobile: true });
  const page = await context.newPage();
  await setup(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "AudioContext", { configurable: true, value: undefined });
    Object.defineProperty(window, "webkitAudioContext", { configurable: true, value: undefined });
    for (const method of ["getItem", "setItem"]) Object.defineProperty(Storage.prototype, method, {
      configurable: true, value() { throw new DOMException("Storage indisponível", "SecurityError"); },
    });
  });
  try {
    await page.goto(origin);
    await page.getByText("Conectado", { exact: true }).waitFor();
    await openSound(page);
    await page.getByRole("button", { name: "Silenciar sons", exact: true }).tap();
    await page.getByRole("button", { name: "Ativar sons", exact: true }).tap();
    await page.getByLabel("Volume", { exact: false }).press("End");
    await closeSound(page);
    await page.getByLabel("Seu apelido").fill("Sem áudio");
    await page.getByRole("button", { name: "Testar com 2 bots", exact: true }).tap();
    await page.getByRole("heading", { name: "Sala de espera", exact: true }).waitFor();
    await page.getByRole("button", { name: "Começar a partida", exact: true }).tap();
    await page.getByRole("heading", { name: "Julgamento", exact: true }).waitFor();
    await page.locator(".answer-group").first().tap();
    await page.getByRole("button", { name: "Escolher vencedora", exact: true }).tap();
    await page.locator(".round-result").waitFor();
    console.info(`${name}: jogo continua sem Web Audio e com armazenamento bloqueado.`);
  } finally {
    await context.close();
  }
}

async function rewardFlow(browser: Browser, name: string) {
  const contexts = await Promise.all([0, 1, 2].map(() => browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true })));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const played: string[][] = [[], [], []];
  try {
    for (const [index, page] of pages.entries()) {
      await setup(page);
      page.on("console", message => {
        try {
          const record = JSON.parse(message.text()) as { event?: string; reason?: string };
          if (record.event === "audio.played" && record.reason) played[index]!.push(record.reason);
        } catch { /* Outros logs. */ }
      });
      await page.goto(origin);
      await page.getByText("Conectado", { exact: true }).waitFor();
      if (index > 0) await page.getByRole("button", { name: "Entrar com código", exact: true }).tap();
      await page.getByLabel("Seu apelido").fill(`Pessoa sonora ${index}`);
      if (index === 0) await page.getByRole("button", { name: "Criar minha sala", exact: true }).tap();
      else {
        await page.getByLabel("Código da sala").fill((await pages[0]!.locator(".lobby-invite strong").textContent())!);
        await page.getByRole("button", { name: "Entrar na sala", exact: true }).tap();
      }
      await page.getByRole("heading", { name: "Sala de espera", exact: true }).waitFor();
    }
    await pages[0]!.getByLabel("Pontos para vencer").fill("3");
    await pages[0]!.getByLabel("Tempo por fase", { exact: true }).selectOption("none");
    await pages[0]!.getByLabel("Tempo para apreciar o resultado").selectOption("manual");
    await pages[0]!.getByRole("button", { name: "Salvar", exact: true }).tap();
    await pages[0]!.getByRole("button", { name: "Começar a partida", exact: true }).tap();
    let ended = false;
    for (let round = 0; round < 5; round++) {
      for (const page of pages) await page.getByRole("heading", { name: "Respostas", exact: true }).waitFor();
      const judgeFlags = await Promise.all(pages.map(page => page.getByRole("status", { name: "Juiz da rodada", exact: true }).textContent().then(text => text!.includes("Você é o juiz"))));
      const judgeIndex = judgeFlags.indexOf(true);
      const winnerIndex = judgeIndex === 0 ? 1 : 0;
      let winningTexts: string[] = [];
      for (const [index, page] of pages.entries()) {
        if (index === judgeIndex) continue;
        if (index === winnerIndex) winningTexts = await page.locator(".answer-card > span").allTextContents().then(texts => texts.slice(0, 3));
        for (const cardIndex of [0, 1, 2]) await page.locator(".answer-card").nth(cardIndex).tap();
        await page.getByRole("button", { name: "Enviar resposta", exact: true }).tap();
      }
      const judge = pages[judgeIndex]!;
      await judge.getByRole("heading", { name: "Julgamento", exact: true }).waitFor();
      const options = judge.locator(".answer-group");
      for (let index = 0; index < await options.count(); index++) {
        if (JSON.stringify(await options.nth(index).locator("li").allTextContents()) === JSON.stringify(winningTexts)) {
          await options.nth(index).tap(); break;
        }
      }
      const before = played.map(events => events.length);
      await judge.getByRole("button", { name: "Escolher vencedora", exact: true }).tap();
      for (const page of pages) await page.locator(".round-result").waitFor();
      ended = await pages[0]!.locator(".game-heading h1").textContent() === "Fim de jogo";
      for (const [index, events] of played.entries()) {
        const expected = ended ? index === winnerIndex ? "victory" : index === judgeIndex ? "judge_ending" : "ending"
          : index === winnerIndex ? "point" : index === judgeIndex ? "judge_confirm" : "result";
        assert(events.slice(before[index]).filter(event => event === expected).length === 1, `${name}: recompensa ${expected} incorreta para jogador ${index}`);
      }
      if (ended) break;
      await pages[0]!.getByRole("button", { name: "Próxima rodada", exact: true }).tap();
    }
    assert(ended, "Partida sonora não terminou");
    assert(played[0]!.filter(sound => sound === "victory").length === 1, "Campeão não recebeu vinheta própria única");
    const beforePreview = played[0]!.length;
    await openSound(pages[0]!);
    await pages[0]!.getByLabel("Volume", { exact: false }).press("ArrowRight");
    assert(!played[0]!.slice(beforePreview).includes("select"), "Prévia de interface sobrepôs a vinheta prioritária de vitória");
    console.info(`${name}: resultado comum, assinatura de ponto, martelo confirmado, vinheta do campeão e encerramento dos demais OK em partida real.`);
  } finally { await Promise.all(contexts.map(context => context.close())); }
}

try {
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch();
    try {
      await audioFlow(browser, engine.name());
      await unavailableAudio(browser, engine.name());
      await rewardFlow(browser, engine.name());
    } finally { await browser.close(); }
  }
  assert(pageErrors.length === 0, `Erros JavaScript: ${pageErrors.join(", ")}`);
  console.info("Áudio OK em Chromium e WebKit. Teste automatizado verifica eventos e nós reais; não substitui escuta em aparelho físico.");
} finally { await app.stop(); }
