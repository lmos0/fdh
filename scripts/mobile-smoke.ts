import assert from "node:assert/strict";
import { chromium, webkit, devices, type Browser, type Locator, type Page } from "playwright";
import { createLogger } from "../shared/logging";
import { loadCatalog } from "../server/src/cards";
import { startServer } from "../server/src/connections";

// Execução opcional, separada dos testes de regras e do build de produção.
// Navegadores: bunx playwright install chromium webkit
const catalog = await loadCatalog();
const logger = createLogger({ level: "silent" });
const app = startServer({ catalog, port: 0, hostname: "127.0.0.1", logger, botTestModeEnabled: false });
const gameApp = startServer({ catalog: { ...catalog, promptIds: ["p17", "p77", "p89"] },
  port: 0, hostname: "127.0.0.1", logger, botTestModeEnabled: true });
const origin = `http://127.0.0.1:${app.server.port}`;
const gameOrigin = `http://127.0.0.1:${gameApp.server.port}`;
const pageErrors: string[] = [];
let audits = 0;

function observe(page: Page) {
  page.setDefaultTimeout(10_000);
  page.on("pageerror", error => pageErrors.push(error.name));
}

async function audit(page: Page, label: string) {
  const result = await page.evaluate(() => {
    const visible = (element: Element) => element.getClientRects().length > 0;
    const describe = (element: Element) => `${element.tagName.toLowerCase()}#${element.id}.${element.className}`;
    const smallTargets = [...document.querySelectorAll("button:not(:disabled), a[href], summary")]
      .filter(visible).filter(element => {
        const rect = element.getBoundingClientRect();
        return rect.width < 43.5 || rect.height < 43.5;
      }).map(describe);
    const smallInputs = [...document.querySelectorAll("input, select")].filter(visible)
      .filter(element => parseFloat(getComputedStyle(element).fontSize) < 16).map(describe);
     const clipped = [...document.querySelectorAll<HTMLElement>(".prompt-card h2, .answer-card > span, .catalog-card p, .player-name, .round-judge > span:last-child")]
      .filter(visible).filter(element => element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1).map(describe);
    const tokens = getComputedStyle(document.documentElement);
    const luminance = (token: string) => {
      const hex = tokens.getPropertyValue(token).trim();
      const channels = hex.slice(1).match(/../g)?.map(channel => {
        const value = parseInt(channel, 16) / 255;
        return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
      });
      return channels?.length === 3 ? channels[0]! * .2126 + channels[1]! * .7152 + channels[2]! * .0722 : 0;
    };
    const contrasts = [["--text", "--bg"], ["--muted", "--surface"],
      ["--primary-text", "--primary"], ["--accent", "--accent-soft"], ["--victory", "--victory-soft"]].map(([foreground, background]) => {
      const a = luminance(foreground!);
      const b = luminance(background!);
      return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
    });
    const tintedAnswers = [...document.querySelectorAll(".answer-card, .catalog-response, .submitted-card, .round-result")]
      .filter(visible).filter(element => {
        const style = getComputedStyle(element);
        return style.backgroundColor !== "rgb(255, 255, 255)" || style.color !== "rgb(17, 17, 17)";
      }).map(describe);
    const themeColor = document.querySelector('meta[name="theme-color"]')?.getAttribute("content");
    return { overflow: document.documentElement.scrollWidth > innerWidth + 1,
      smallTargets, smallInputs, clipped, scale: visualViewport?.scale ?? 1, contrasts, tintedAnswers,
      themeColorMatches: themeColor === tokens.getPropertyValue("--bg").trim() };
  });
  assert(!result.overflow, `${label}: rolagem horizontal`);
  assert(result.smallTargets.length === 0, `${label}: alvos menores que 44px: ${result.smallTargets.join(", ")}`);
  assert(result.smallInputs.length === 0, `${label}: fonte de campo abaixo de 16px: ${result.smallInputs.join(", ")}`);
  assert(result.clipped.length === 0, `${label}: texto recortado: ${result.clipped.join(", ")}`);
  assert(Math.abs(result.scale - 1) < .01, `${label}: viewport com escala inesperada`);
  assert(result.contrasts.every(ratio => ratio >= 4.5), `${label}: contraste de texto inferior a 4.5:1`);
  assert(result.tintedAnswers.length === 0, `${label}: cartas de resposta deixaram de ser brancas com texto preto`);
  assert(result.themeColorMatches, `${label}: cor do navegador diferente do tema escolhido`);
  audits++;
}

async function chooseTheme(page: Page, theme: "light" | "dark") {
  if (await page.locator("html").getAttribute("data-theme") !== theme) {
    if (await page.locator(".game-menu").count()) await page.locator(".game-menu > summary").tap();
    await page.getByRole("button", { name: theme === "light" ? "Ativar tema claro" : "Ativar tema escuro", exact: true }).tap();
  }
}

function contextOptions(deviceName: string, viewport: { width: number; height: number }) {
  const device = devices[deviceName];
  assert(device, `Perfil não encontrado: ${deviceName}`);
  return { viewport, deviceScaleFactor: device.deviceScaleFactor, userAgent: device.userAgent,
    isMobile: true, hasTouch: true, locale: "pt-BR", colorScheme: "light" as const };
}

async function layoutMatrix(browser: Browser, deviceName: string) {
  const context = await browser.newContext(contextOptions(deviceName, { width: 360, height: 640 }));
  const page = await context.newPage();
  observe(page);
  const sizes = [
    { width: 320, height: 568 }, { width: 360, height: 640 }, { width: 375, height: 667 },
    { width: 390, height: 844 }, { width: 430, height: 932 }, { width: 768, height: 1024 },
    { width: 844, height: 390 },
  ];
  try {
    for (const theme of ["light", "dark"] as const) {
      for (const viewport of sizes) {
        await page.setViewportSize(viewport);
        await page.goto(origin);
        await page.getByRole("heading", { name: "Jogar", exact: true }).waitFor();
        await chooseTheme(page, theme);
        assert(await page.locator(".test-mode-button").count() === 0, "Botão de bots não pode existir no DOM com flag desabilitada");
        await page.locator(".sound-controls > summary").tap();
        await audit(page, `${deviceName} / ${theme} / ${viewport.width} / controle de som`);
        const popover = await page.locator(".sound-popover").boundingBox();
        assert(popover && popover.x >= 0 && popover.x + popover.width <= viewport.width + 1, "Controle de som fora da tela");
        await page.locator(".sound-controls > summary").tap();
        await page.getByRole("button", { name: "Entrar com código", exact: true }).tap();
        await audit(page, `${deviceName} / ${theme} / ${viewport.width} / entrada`);
        await page.goto(`${origin}/cards`);
        await page.getByRole("button", { name: "Respostas (459)", exact: true }).waitFor();
        await audit(page, `${deviceName} / ${theme} / ${viewport.width} / respostas`);
        await page.getByRole("button", { name: "Perguntas / prompts (90)", exact: true }).tap();
        await page.getByLabel("Cartas por resposta").selectOption("3");
        assert(await page.locator(".catalog-card").count() === 2, "Filtro de perguntas triplas incorreto");
        await audit(page, `${deviceName} / ${theme} / ${viewport.width} / perguntas`);
      }
    }

    // Área útil reduzida: emulação não abre um teclado físico de iOS/Android.
    await page.setViewportSize({ width: 360, height: 300 });
    await page.goto(origin);
    await page.getByText("Conectado", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Entrar com código", exact: true }).tap();
    await page.getByLabel("Seu apelido").tap();
    await page.getByLabel("Seu apelido").fill("Teste teclado");
    const codeInput = page.getByLabel("Código da sala");
    await codeInput.tap();
    await codeInput.fill("ZZZZZZ");
    const box = await codeInput.boundingBox();
    assert(box && box.y >= 0 && box.y + box.height <= 301, "Campo não acessível com área útil reduzida");
    await codeInput.press("Enter");
    await page.getByRole("alert").waitFor();
    await audit(page, `${deviceName} / área útil reduzida e erro`);
    await page.getByRole("button", { name: "Fechar erro", exact: true }).tap();

    await page.setViewportSize({ width: 320, height: 568 });
    await page.goto(`${origin}/cards`);
    await page.getByRole("button", { name: "Respostas (459)", exact: true }).waitFor();
    const search = page.getByLabel("Buscar por texto ou ID");
    await search.tap();
    await search.fill("r262");
    await search.press("Enter");
    assert(await search.evaluate(element => document.activeElement !== element), "Busca não liberou o foco ao confirmar");
    assert(await page.locator(".catalog-card").count() === 1, "Busca por ID incorreta");
    await audit(page, `${deviceName} / carta longa`);
    await search.fill("");
    await page.getByRole("button", { name: "Próxima", exact: false }).tap();
    await page.getByText("Página 2 de 20", { exact: true }).waitFor();
    const firstCard = await page.locator(".catalog-card").first().boundingBox();
    assert(firstCard && firstCard.y < 200, "Paginação não voltou ao início das cartas");
    await audit(page, `${deviceName} / paginação`);
  } finally {
    await context.close();
  }
}

async function gameByTouch(browser: Browser, deviceName: string) {
  const widths = [320, 390, 430];
  const contexts = await Promise.all(widths.map(width => browser.newContext(contextOptions(deviceName, { width, height: 844 }))));
  const pages = await Promise.all(contexts.map(context => context.newPage()));
  const names = ["AnfitriaoComNomeBemLongo01", "SegundoJogadorNomeLongo12", "TerceiroJogadorNomeLongo12"].map(name => name.slice(0, 24));
  assert(new Set(names).size === 3, "Apelidos de teste precisam ser distintos");
  try {
    for (const page of pages) observe(page);
    await pages[0]!.goto(gameOrigin);
    await pages[0]!.getByText("Conectado", { exact: true }).waitFor();
    await pages[0]!.getByLabel("Seu apelido").tap();
    await pages[0]!.getByLabel("Seu apelido").fill(names[0]!);
    await pages[0]!.getByRole("button", { name: "Criar minha sala", exact: true }).tap();
    await pages[0]!.getByRole("heading", { name: "Sala de espera", exact: true }).waitFor();
    const code = (await pages[0]!.locator(".lobby-invite strong").textContent())!;
    for (const index of [1, 2]) {
      const page = pages[index]!;
      await page.goto(index === 1 ? gameOrigin : `${gameOrigin}/?room=${code}`);
      await page.getByText("Conectado", { exact: true }).waitFor();
      if (index === 1) await page.getByRole("button", { name: "Entrar com código", exact: true }).tap();
      await page.getByLabel("Seu apelido").tap();
      await page.getByLabel("Seu apelido").fill(names[index]!);
      await page.getByLabel("Código da sala").fill(code);
      await page.getByRole("button", { name: "Entrar na sala", exact: true }).tap();
      await page.getByRole("heading", { name: "Sala de espera", exact: true }).waitFor();
      await chooseTheme(page, index === 1 ? "dark" : "light");
    }
    for (const page of pages) await audit(page, `${deviceName} / lobby e nomes longos`);
    await pages[1]!.emulateMedia({ reducedMotion: "reduce" });

    // Exercitar o fallback para dispositivos sem API de clipboard disponível.
    await pages[0]!.evaluate(() => Object.defineProperty(navigator, "clipboard", {
      configurable: true, value: { writeText: () => Promise.reject(new Error("Clipboard indisponível")) },
    }));
    await pages[0]!.getByRole("button", { name: "Copiar convite", exact: true }).tap();
    const invite = pages[0]!.getByLabel("Link de convite");
    await invite.waitFor();
    await invite.tap();
    assert((await invite.inputValue()).includes(code), "Convite incorreto");
    await audit(pages[0]!, `${deviceName} / convite manual`);
    await pages[0]!.getByRole("button", { name: "Fechar link", exact: true }).tap();
    await pages[0]!.getByText("Regras", { exact: true }).tap();
    await pages[0]!.getByLabel("Pontos para vencer").tap();
    await pages[0]!.getByLabel("Pontos para vencer").fill("3");
    assert(await pages[0]!.getByLabel("Tempo para apreciar o resultado").inputValue() === "15", "Intervalo padrão deve permitir leitura");
    await pages[0]!.getByLabel("Tempo para apreciar o resultado").selectOption("manual");
    await pages[0]!.getByLabel("Tempo por fase", { exact: true }).selectOption("none");
    await pages[0]!.getByRole("button", { name: "Salvar", exact: true }).tap();
    await pages[0]!.waitForFunction(() => (document.querySelector(".settings-form button") as HTMLButtonElement)?.disabled);
    await pages[0]!.getByRole("button", { name: "Começar a partida", exact: true }).tap();

    const seen = new Set<number>();
    let previousJudgeIndex: number | null = null;
    async function verifyJudge(judgeIndex: number) {
      for (const [index, page] of pages.entries()) {
        const status = page.getByRole("status", { name: "Juiz da rodada", exact: true });
        await status.waitFor();
        assert((await status.textContent())?.trim() === (index === judgeIndex
          ? "Você é o juiz desta rodada" : `Juiz da rodada: ${names[judgeIndex]}`), "Identificação incorreta do juiz");
        assert(await status.locator(".judge-icon").count() === 1, "Ícone ausente na identificação do juiz");
        const highlighted = page.locator(".player-list .player-judge");
        assert(await highlighted.count() === 1, "Deve existir somente um juiz destacado no placar");
        assert((await highlighted.locator(".player-name").textContent())?.startsWith(names[judgeIndex]!), "Placar destaca jogador incorreto");
        assert((await highlighted.locator(".judge-badge").textContent())?.trim() === "Juiz", "Marcador textual de juiz ausente");
        const statusPosition = await status.boundingBox();
        const promptPosition = await page.locator(".prompt-card").boundingBox();
        assert(statusPosition && promptPosition && statusPosition.y + statusPosition.height <= promptPosition.y,
          "Identificação do juiz precisa aparecer antes da pergunta");
      }
    }
    let rounds = 0;
    while (rounds++ < 8) {
      await pages[0]!.getByRole("heading", { name: "Respostas", exact: true }).waitFor();
      if (rounds === 2) await pages[2]!.setViewportSize({ width: 844, height: 390 });
      if (rounds === 3) await pages[2]!.setViewportSize({ width: 430, height: 844 });
      const flags = await Promise.all(pages.map(page => page.getByRole("status", { name: "Juiz da rodada", exact: true })
        .textContent().then(text => text!.includes("Você é o juiz desta rodada"))));
      const judgeIndex: number = flags.indexOf(true);
      assert(judgeIndex >= 0, "Juiz não encontrado");
      assert(flags.filter(Boolean).length === 1, "Mais de um jogador identificado como juiz");
      if (previousJudgeIndex !== null) assert(judgeIndex === (previousJudgeIndex + 1) % 3, "Juiz destacado não acompanhou o rodízio");
      previousJudgeIndex = judgeIndex;
      await verifyJudge(judgeIndex);
      await pages[judgeIndex]!.getByRole("heading", { name: "Aguarde as respostas para escolher a vencedora", exact: true }).waitFor();
      assert(await pages[0]!.locator('.phase-steps [aria-current="step"]').textContent() === "1Responder", "Sequência não indica fase de respostas");
      const header = await pages[0]!.locator(".site-header").boundingBox();
      assert(header && header.height <= 80, "Cabeçalho da partida não está compacto");
      if (rounds === 1) {
        await pages[0]!.locator(".game-menu > summary").tap();
        await pages[0]!.getByRole("button", { name: "Copiar convite", exact: true }).waitFor();
        await audit(pages[0]!, `${deviceName} / menu secundário da partida`);
        await pages[0]!.locator(".game-menu > summary").press("Escape");
        assert(await pages[0]!.locator(".game-menu").getAttribute("open") === null, "Escape não fechou menu");
      }
      assert(await pages[judgeIndex]!.getByRole("button", { name: "Enviar resposta", exact: true }).count() === 0, "Juiz não deve receber ação de enviar carta");
      const instructions = (await pages[0]!.locator(".prompt-meta").last().textContent())!;
      const pick = Number(instructions.match(/Escolha (\d)/)![1]);
      const draw = Number(instructions.match(/\+(\d)/)?.[1] ?? 0);
      seen.add(pick);
      for (const page of pages) await audit(page, `${deviceName} / rodada ${rounds} / envio`);
      const respondents: number[] = [0, 1, 2].filter(index => index !== judgeIndex);
      if (rounds === 1) {
        await pages[0]!.getByRole("button", { name: "Pausar para todos", exact: true }).tap();
        for (const page of pages) await page.getByText("Pausa coletiva. Qualquer participante pode retomar. Os prazos estão congelados.", { exact: true }).waitFor();
        assert(await pages[respondents[0]!]!.locator(".answer-card:enabled").count() === 0, "Pausa deve bloquear seleção");
        await pages[1]!.getByRole("button", { name: "Retomar para todos", exact: true }).tap();
        await pages[respondents[0]!]!.locator(".answer-card:enabled").first().waitFor();
      }
      for (const [position, index] of respondents.entries()) {
        const page: Page = pages[index]!;
        assert(await page.locator(".answer-card").count() === 7 + draw, "Mão com quantidade incorreta");
        assert(await page.locator(".slot-button").count() === pick, "Espaços da combinação ausentes na barra de envio");
        assert(await page.getByRole("button", { name: "Enviar resposta", exact: true }).isDisabled(), "Envio liberado sem seleção");
        const indexes = pick === 1 ? [0] : pick === 2 ? [2, 0] : [2, 0, 4];
        for (const cardIndex of indexes) await page.locator(".answer-card").nth(cardIndex).tap();
        if (rounds === 1) {
          const current = await page.locator("html").getAttribute("data-theme");
          await chooseTheme(page, current === "dark" ? "light" : "dark");
          assert(await page.locator(".answer-card.selected").count() === pick, "Troca de tema perdeu seleção");
        }
        const chosen = await Promise.all(indexes.map(cardIndex => page.locator(".answer-card > span").nth(cardIndex).textContent()));
        assert(JSON.stringify(await page.locator(".slot-button .slot-text").allTextContents()) === JSON.stringify(chosen), "Espaços da barra de envio não acompanharam a seleção");
        assert(await page.locator(".prompt-card h2 .prompt-fill").count() === pick, "Pergunta não mostrou as cartas escolhidas nas lacunas");
        assert(await page.locator(".answer-card.selected .selection-order").count() === pick, "Marcador de ordem ausente na carta selecionada");
        if (pick > 1) {
          assert(await page.locator(".answer-card:enabled").count() === 7 + draw, "Combinação cheia bloqueou substituição");
          await page.getByRole("button", { name: /^1ª carta: / }).tap();
          await page.getByRole("button", { name: "Mover 1ª carta para depois", exact: true }).tap();
          const reordered = [...chosen];
          [reordered[0], reordered[1]] = [reordered[1]!, reordered[0]!];
          assert(JSON.stringify(await page.locator(".slot-button .slot-text").allTextContents()) === JSON.stringify(reordered), "Mover não reorganizou a combinação");
          await page.getByRole("button", { name: "Mover 2ª carta para antes", exact: true }).tap();
          await page.locator(".answer-card").nth(6).tap();
          assert((await page.locator(".slot-button .slot-text").first().textContent()) === (await page.locator(".answer-card > span").nth(6).textContent()), "Substituição alterou o espaço errado");
          await page.locator(".answer-card").nth(indexes[0]!).tap();
          await page.getByRole("button", { name: "Remover", exact: true }).tap();
          assert(await page.getByRole("button", { name: "Enviar resposta", exact: true }).isDisabled(), "Envio liberado com espaço vazio");
          await page.locator(".answer-card").nth(indexes[0]!).tap();
        }
        assert(JSON.stringify(await page.locator(".slot-button .slot-text").allTextContents()) === JSON.stringify(chosen), "Prévia não preservou a ordem escolhida");
        if (rounds === 1 || pick === 3) {
          const dock = page.getByRole("region", { name: "Seleção e envio", exact: true });
          await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
          const box = await dock.boundingBox();
          const height = await page.evaluate(() => innerHeight);
          assert(box && Math.abs(box.y + box.height - height) < 2, "Barra não ficou fixa no rodapé");
          const reserved = await page.locator(".game-layout").evaluate(element => parseFloat(getComputedStyle(element).paddingBottom));
          assert(reserved >= box.height, "Espaço da barra não foi reservado");
          await page.locator(".dock-question").tap();
          assert((await page.locator(".dock-review p").textContent()) === (await page.locator(".prompt-card h2").textContent()), "Resumo da pergunta divergente");
          assert(JSON.stringify(await page.locator(".dock-review li").allTextContents()) === JSON.stringify(chosen), "Revisão não juntou pergunta e combinação atual");
          await audit(page, `${deviceName} / pergunta e prévia fixas / PICK ${pick}`);
          await page.locator(".dock-question").tap();
          assert(await page.locator(".dock-review").count() === 0, "Revisão da pergunta não fechou");
        }
        await page.getByText("Após enviar, não será possível alterar.", { exact: true }).waitFor();
        await page.getByRole("button", { name: "Enviar resposta", exact: true }).tap();
        if (position === 0) {
          await page.locator(".submitted-card").waitFor();
          assert(JSON.stringify(await page.locator(".submitted-card li").allTextContents()) === JSON.stringify(chosen), "Ordem alterada no envio");
          if (rounds === 1) {
            await page.reload();
            await page.getByText("Conectado", { exact: true }).waitFor();
            await page.locator(".submitted-card").waitFor();
            await page.getByText("✓ Enviada", { exact: true }).waitFor();
            assert(JSON.stringify(await page.locator(".submitted-card li").allTextContents()) === JSON.stringify(chosen), "Reconexão perdeu resposta");
            await verifyJudge(judgeIndex);
          }
        }
      }
      const judge: Page = pages[judgeIndex]!;
      await judge.getByRole("heading", { name: "Julgamento", exact: true }).waitFor();
      await judge.getByText("Sua vez de julgar", { exact: true }).waitFor();
      assert(await judge.locator('.phase-steps [aria-current="step"]').textContent() === "2Julgar", "Sequência não indica julgamento");
      await verifyJudge(judgeIndex);
      for (const index of respondents) await pages[index]!.getByRole("heading", {
        name: `${names[judgeIndex]} está escolhendo a vencedora`, exact: true,
      }).waitFor();
      for (const page of pages) await audit(page, `${deviceName} / julgamento`);
      const option: Locator = judge.locator(".answer-group").first();
      const expected: string[] = await option.locator("li").allTextContents();
      assert(expected.length === pick, "Combinação incompleta no julgamento");
      await option.tap();
      await judge.getByRole("button", { name: "Escolher vencedora", exact: true }).tap();
      await pages[0]!.locator(".round-result").waitFor();
      assert(JSON.stringify(await pages[0]!.locator(".round-result li").allTextContents()) === JSON.stringify(expected), "Resultado alterou combinação");
      assert(await pages[0]!.locator(".round-result").evaluate(element => parseFloat(getComputedStyle(element).borderTopWidth) >= 2), "Vencedora não recebeu moldura especial");
      assert(await pages[0]!.locator(".winner-identity .player-avatar").count() === 1, "Resultado sem avatar do autor");
      assert(await pages[0]!.locator(".player-list .point-gain").count() === 1, "+1 ausente próximo ao placar");
      assert(await pages[1]!.locator(".round-result").evaluate(element => getComputedStyle(element).animationName === "none"), "Revelação ignorou movimento reduzido");
      assert(await pages[1]!.locator(".result-particles").evaluateAll(elements => elements.every(element => getComputedStyle(element).display === "none")), "Partículas presentes com movimento reduzido");
      for (const page of pages) await audit(page, `${deviceName} / resultado`);
      if (rounds === 1) {
        const winner = await pages[0]!.locator(".winner-name").textContent();
        await pages[0]!.reload();
        await pages[0]!.getByText("Conectado", { exact: true }).waitFor();
        await pages[0]!.locator(".round-result").waitFor();
        assert(await pages[0]!.locator(".winner-name").textContent() === winner, "Reconexão perdeu o autor vencedor");
        assert(await pages[0]!.locator(".round-result.is-revealing").count() === 0, "Reconexão repetiu celebração visual");
      }
      await pages[0]!.locator(".winning-history > summary").tap();
      const latest = pages[0]!.locator(".history-list > li").first();
      // Com lacunas, o histórico mostra as cartas dentro da pergunta, sem o ponto final de cada carta.
      const plain = (texts: string[]) => JSON.stringify(texts.map(text => text.replace(/\.$/, "")));
      assert(plain(await latest.locator(".prompt-fill, .response-list li").allTextContents()) === plain(expected), "Histórico perdeu a combinação vencedora");
      assert(plain(await pages[0]!.locator(".prompt-card h2 .prompt-fill").allTextContents()) === plain(expected), "Pergunta não mostrou a combinação vencedora");
      assert((await latest.locator(".history-prompt").textContent()) === (await pages[0]!.locator(".prompt-card h2").textContent()), "Histórico perdeu a pergunta");
      assert((await latest.locator(".history-author").textContent())?.includes((await pages[0]!.locator(".round-result .winner-name").textContent())!), "Histórico perdeu o autor");
      await pages[0]!.locator(".winning-history > summary").tap();
      if (await pages[0]!.locator(".game-heading h1").textContent() !== "Fim de jogo") {
        await pages[0]!.locator(".result-next").getByText("O anfitrião avança a próxima rodada", { exact: true }).waitFor();
        assert(await pages[1]!.getByRole("button", { name: "Próxima rodada", exact: true }).count() === 0, "Não anfitrião recebeu avanço manual");
        await pages[0]!.getByRole("button", { name: "Próxima rodada", exact: true }).tap();
      }
      await pages[0]!.waitForFunction(() => ["Fim de jogo", "Respostas"].includes(document.querySelector(".game-heading h1")?.textContent ?? ""));
      if (await pages[0]!.locator(".game-heading h1").textContent() === "Fim de jogo") break;
      await pages[0]!.waitForFunction(() => scrollY < 2);
      const judgeNotice = await pages[0]!.getByRole("status", { name: "Juiz da rodada", exact: true }).boundingBox();
      const viewportHeight = await pages[0]!.evaluate(() => innerHeight);
      assert(judgeNotice && judgeNotice.y >= 0 && judgeNotice.y + judgeNotice.height < viewportHeight,
        "Identificação do juiz não ficou visível no início da rodada");
    }
    assert(rounds <= 7, "Partida não encerrou no limite esperado");
    assert(await pages[0]!.locator(".final-ranking > li").count() === 3, "Classificação final incompleta");
    await pages[0]!.getByText("Campeão da partida", { exact: true }).waitFor();
    await pages[0]!.getByRole("heading", { name: "Última combinação vencedora", exact: true }).waitFor();
    assert([1, 2, 3].every(pick => seen.has(pick)), "Faltou testar uma quantidade de cartas");
    for (const page of pages) await audit(page, `${deviceName} / fim da partida`);
    await pages[0]!.getByRole("button", { name: "Voltar para o início", exact: true }).tap();
    await pages[0]!.getByRole("heading", { name: "Jogar", exact: true }).waitFor();
    console.info(`${deviceName}: partida por toque concluída em ${rounds} rodadas, com 1/2/3 cartas e reconexão.`);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
}

async function soloByTouch(browser: Browser, deviceName: string) {
  const context = await browser.newContext(contextOptions(deviceName, { width: 390, height: 844 }));
  const page = await context.newPage();
  observe(page);
  try {
    await page.goto(gameOrigin);
    await page.getByText("Conectado", { exact: true }).waitFor();
    await page.getByLabel("Seu apelido").fill("Pessoa testando UI");
    await page.getByRole("button", { name: "Testar com 2 bots", exact: true }).tap();
    await page.getByRole("heading", { name: "Sala de espera", exact: true }).waitFor();
    await page.getByRole("note", { name: "Modo de teste", exact: true }).waitFor();
    assert(await page.locator(".player-list li").count() === 3, "Teste precisa de uma pessoa e dois bots");
    assert(await page.locator(".bot-badge").count() === 2, "Bots não estão identificados");
    assert(await page.getByRole("button", { name: "Copiar convite", exact: true }).count() === 0, "Sala de teste não deve oferecer convite");
    await chooseTheme(page, "dark");
    await page.reload();
    await page.getByText("Conectado", { exact: true }).waitFor();
    await page.getByRole("heading", { name: "Sala de espera", exact: true }).waitFor();
    assert(await page.locator(".bot-badge").count() === 2, "Reconexão duplicou os bots");
    await audit(page, `${deviceName} / lobby de teste solo`);
    await page.getByLabel("Pontos para vencer").fill("3");
    await page.getByLabel("Tempo para apreciar o resultado").selectOption("5");
    await page.getByRole("button", { name: "Salvar", exact: true }).tap();
    await page.waitForFunction(() => (document.querySelector(".settings-form button") as HTMLButtonElement)?.disabled);
    await page.getByRole("button", { name: "Começar a partida", exact: true }).tap();
    const seen = new Set<number>();
    let rounds = 0;
    while (rounds++ < 8) {
      await page.getByRole("heading", { name: "Respostas", exact: true }).waitFor();
      const judgeStatus = page.getByRole("status", { name: "Juiz da rodada", exact: true });
      const isJudge = (await judgeStatus.textContent())!.includes("Você é o juiz desta rodada");
      assert(isJudge === ((rounds - 1) % 3 === 0), "Rodízio de juiz incorreto no teste solo");
      const highlighted = page.locator(".player-judge");
      assert(await highlighted.locator(".bot-badge").count() === (isJudge ? 0 : 1), "Marcador Bot incorreto no juiz");
      const instructions = (await page.locator(".prompt-meta").last().textContent())!;
      const pick = Number(instructions.match(/Escolha (\d)/)![1]);
      seen.add(pick);
      await audit(page, `${deviceName} / teste solo / respostas`);
      if (isJudge) {
        assert(await page.getByRole("button", { name: "Enviar resposta", exact: true }).count() === 0, "Humano juiz não pode enviar carta");
        await page.getByRole("heading", { name: "Julgamento", exact: true }).waitFor();
        if (rounds === 1) {
          const previousOptions = await page.locator(".answer-group .response-list").allTextContents();
          await page.reload();
          await page.getByText("Conectado", { exact: true }).waitFor();
          await page.getByRole("heading", { name: "Julgamento", exact: true }).waitFor();
          assert(JSON.stringify(await page.locator(".answer-group .response-list").allTextContents()) === JSON.stringify(previousOptions),
            "Reconexão no teste solo alterou as opções");
          await chooseTheme(page, "light");
        }
        assert(await page.locator(".answer-group").count() === 2, "Bots não enviaram as duas respostas");
        const options = page.locator(".answer-group");
        assert(await options.first().locator("li").count() === pick, "Bot não respeitou PICK");
        await audit(page, `${deviceName} / teste solo / juiz humano`);
        await options.first().tap();
        await page.getByRole("button", { name: "Escolher vencedora", exact: true }).tap();
      } else {
        const cards = page.locator(".answer-card");
        for (let index = 0; index < pick; index++) await cards.nth(index).tap();
        await page.getByRole("button", { name: "Enviar resposta", exact: true }).tap();
        // Sem comando de julgamento do humano: o bot conclui a rodada sozinho.
      }
      await page.locator(".round-result").waitFor();
      const scores = await page.locator(".player-list .score").allTextContents();
      assert(scores.reduce((sum, score) => sum + Number.parseInt(score), 0) === rounds, "Pontuação duplicada ou rodada sem ponto no teste solo");
      await audit(page, `${deviceName} / teste solo / resultado`);
      if (await page.locator(".game-heading h1").textContent() !== "Fim de jogo") {
        assert((await page.locator(".game-tools .phase-clock").textContent())?.includes("Próxima rodada em"), "Contagem do resultado não está visível");
      }
      await page.waitForFunction(() => ["Fim de jogo", "Respostas"].includes(document.querySelector(".game-heading h1")?.textContent ?? ""));
      if (await page.locator(".game-heading h1").textContent() === "Fim de jogo") break;
    }
    assert(rounds <= 7, "Teste solo não encerrou ao atingir a meta");
    assert([1, 2, 3].every(pick => seen.has(pick)), "Teste solo não cobriu todos os tipos de pergunta");
    await page.getByRole("button", { name: "Voltar para o início", exact: true }).tap();
    await page.getByRole("heading", { name: "Jogar", exact: true }).waitFor();
    assert(await page.getByRole("note", { name: "Modo de teste", exact: true }).count() === 0, "Aviso de teste permaneceu após sair");
    console.info(`${deviceName}: teste solo completo com dois bots em ${rounds} rodadas, reconexão e julgamento automático.`);
  } finally {
    await context.close();
  }
}

async function featureFlagByTouch(browser: Browser, deviceName: string) {
  const context = await browser.newContext(contextOptions(deviceName, { width: 320, height: 568 }));
  const page = await context.newPage();
  observe(page);
  // Segurar a configuração demonstra que não há flash do botão antes da resposta do servidor.
  let releaseConfig: (() => void) | null = null;
  await page.routeWebSocket("**/ws", socket => {
    const server = socket.connectToServer();
    server.onMessage(message => {
      if (typeof message === "string" && JSON.parse(message).type === "server.config") {
        releaseConfig = () => socket.send(message);
      } else socket.send(message);
    });
  });
  try {
    await page.goto(gameOrigin);
    await page.getByText("Conectado", { exact: true }).waitFor();
    assert(await page.locator(".test-mode-button").count() === 0, "Botão apareceu antes de conhecer a flag");
    assert(releaseConfig, "Configuração do servidor não recebida");
    (releaseConfig as () => void)();
    await page.getByRole("button", { name: "Testar com 2 bots", exact: true }).waitFor();
    await audit(page, `${deviceName} / feature flag habilitada`);
    await page.goto(origin);
    await page.getByText("Conectado", { exact: true }).waitFor();
    assert(releaseConfig, "Configuração do servidor desabilitado não recebida");
    (releaseConfig as () => void)();
    // Um comando normal garante que a configuração anterior já foi processada pelo socket.
    await page.getByLabel("Seu apelido").fill("Flag desligada");
    await page.getByRole("button", { name: "Criar minha sala", exact: true }).tap();
    await page.getByRole("heading", { name: "Sala de espera", exact: true }).waitFor();
    await page.getByRole("button", { name: "Sair", exact: true }).tap();
    await page.getByRole("heading", { name: "Jogar", exact: true }).waitFor();
    assert(await page.locator(".test-mode-button").count() === 0, "Flag antiga reapareceu no servidor desabilitado");
    await audit(page, `${deviceName} / feature flag desabilitada`);
    console.info(`${deviceName}: botão de teste ausente do DOM por padrão e exibido somente após flag explícita do servidor.`);
  } finally { await context.close(); }
}

async function clocksByTouch(browser: Browser, deviceName: string) {
  const context = await browser.newContext(contextOptions(deviceName, { width: 320, height: 568 }));
  const page = await context.newPage();
  observe(page);
  // Relógio local muito adiantado não deve encerrar o cronômetro autoritativo.
  await page.addInitScript(() => { const realNow = Date.now; Date.now = () => realNow() + 86_400_000; });
  try {
    await page.goto(gameOrigin);
    await page.getByText("Conectado", { exact: true }).waitFor();
    await page.getByLabel("Seu apelido").fill("Teste de prazos");
    await page.getByRole("button", { name: "Testar com 2 bots", exact: true }).tap();
    await page.getByRole("heading", { name: "Sala de espera", exact: true }).waitFor();
    await page.getByLabel("Tempo por fase", { exact: true }).selectOption("30");
    await page.getByLabel("Tempo para apreciar o resultado").selectOption("manual");
    await page.getByRole("button", { name: "Salvar", exact: true }).tap();
    await page.waitForFunction(() => (document.querySelector(".settings-form button") as HTMLButtonElement)?.disabled);
    await page.getByRole("button", { name: "Começar a partida", exact: true }).tap();
    await page.getByRole("heading", { name: "Julgamento", exact: true }).waitFor();
    assert((await page.locator(".game-tools .phase-clock").textContent())!.includes("0:30") ||
      (await page.locator(".game-tools .phase-clock").textContent())!.includes("0:29"), "Relógio local alterou prazo do servidor");
    await page.getByRole("button", { name: "Pausar para todos", exact: true }).tap();
    await page.getByText(/Tempo congelado:/).waitFor();
    const frozen = await page.locator(".game-tools .phase-clock").textContent();
    await page.reload();
    await page.getByRole("button", { name: "Retomar para todos", exact: true }).waitFor();
    assert((await page.locator(".game-tools .phase-clock").textContent()) === frozen, "Reconexão consumiu tempo da pausa coletiva");
    await audit(page, `${deviceName} / relógio congelado e reconexão`);
    await page.getByRole("button", { name: "Retomar para todos", exact: true }).tap();
    await page.getByText("O prazo está acabando.", { exact: true }).waitFor({ timeout: 30_000 });
    await audit(page, `${deviceName} / aviso discreto de prazo`);
    // Sem escolher: o servidor precisa cancelar sem pontos e girar o juiz.
    await page.getByRole("heading", { name: "Respostas", exact: true }).waitFor({ timeout: 15_000 });
    await page.getByText("Rodada 2", { exact: true }).waitFor();
    assert(await page.locator(".player-list .score").allTextContents().then(scores => scores.every(score => Number.parseInt(score) === 0)), "Juiz inativo concedeu pontos");
    assert(await page.locator(".winning-history").count() === 0, "Cancelamento entrou no histórico");
    assert(await page.getByRole("region", { name: "Seleção e envio", exact: true }).count() === 1, "Nova rodada não ofereceu envio");
    await audit(page, `${deviceName} / cancelamento automático de juiz inativo`);
    console.info(`${deviceName}: prazos reais, aviso, pausa/reconexão e cancelamento de juiz inativo OK, com relógio local adiantado.`);
  } finally { await context.close(); }
}

try {
  for (const profile of [{ engine: chromium, device: "Pixel 7" }, { engine: webkit, device: "iPhone 13 Mini" }]) {
    const browser = await profile.engine.launch();
    try {
      await layoutMatrix(browser, profile.device);
      await featureFlagByTouch(browser, profile.device);
      await gameByTouch(browser, profile.device);
      await soloByTouch(browser, profile.device);
      await clocksByTouch(browser, profile.device);
    } finally {
      await browser.close();
    }
  }
  assert(pageErrors.length === 0, `Erros JavaScript: ${pageErrors.join(", ")}`);
  console.info(`Mobile OK: ${audits} verificações em Chromium/Android e WebKit/iPhone, dois temas, 320–844px e paisagem.`);
} finally {
  await app.stop();
  await gameApp.stop();
}
