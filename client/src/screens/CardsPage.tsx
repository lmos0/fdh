import { useEffect, useMemo, useRef, useState } from "react";
import type { CardCatalogView, CardView, PromptView } from "../../../shared/protocol";
import { GAME_NAME } from "../../../shared/branding";
import { Brand } from "../components/Brand";
import { logger } from "../connection/logger";
import { ThemeToggle } from "../components/ThemeToggle";
import { SoundControls } from "../components/SoundControls";

const PAGE_SIZE = 24;
const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("pt-BR");

export function CardsPage() {
  const [catalog, setCatalog] = useState<CardCatalogView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [type, setType] = useState<"responses" | "prompts">("responses");
  const [query, setQuery] = useState("");
  const [pick, setPick] = useState("all");
  const [page, setPage] = useState(1);
  const resultsRef = useRef<HTMLDivElement>(null);
  function changePage(nextPage: number) {
    setPage(nextPage);
    resultsRef.current?.scrollIntoView({ block: "start", behavior: "auto" });
  }

  useEffect(() => {
    document.title = `Catálogo de cartas — ${GAME_NAME}`;
    const startedAt = performance.now();
    logger.debug("catalog.requested", { attempt: attempt + 1 });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20_000);
    let active = true;
    setError(null);
    void fetch("/api/cards", { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("Catálogo indisponível.");
      const data: CardCatalogView = await response.json();
      if (!Array.isArray(data.prompts) || !Array.isArray(data.responses)) throw new Error("Catálogo inválido.");
      if (active) {
        setCatalog(data);
        logger.info("catalog.loaded", { promptCount: data.prompts.length, responseCount: data.responses.length,
          durationMs: Math.round(performance.now() - startedAt) });
      }
    }).catch(() => {
      if (active) {
        logger.warn("catalog.load_failed", { attempt: attempt + 1, reason: controller.signal.aborted ? "timeout" : "request_failed" });
        setError("Não foi possível carregar as cartas. O servidor pode estar iniciando. Tente novamente.");
      }
    }).finally(() => clearTimeout(timeout));
    return () => { active = false; clearTimeout(timeout); controller.abort(); };
  }, [attempt]);

  const filtered = useMemo(() => {
    const search = normalize(query.trim());
    const cards: (CardView | PromptView)[] = catalog?.[type] ?? [];
    return cards.filter(card => (!search || normalize(`${card.id} ${card.text}`).includes(search)) &&
      (type !== "prompts" || pick === "all" || ("pick" in card && card.pick === Number(pick))));
  }, [catalog, type, query, pick]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const total = catalog ? catalog.prompts.length + catalog.responses.length : null;

  return <div className="app-shell">
    <header className="site-header">
      <Brand />
      <div className="header-actions"><a className="catalog-link" href="/">Voltar ao jogo</a><SoundControls /><ThemeToggle /></div>
    </header>
    <main className="catalog-page">
      <div className="catalog-heading"><h1>Cartas</h1>
        {total !== null && <span className="count-pill">{total} cartas</span>}
      </div>
      <p className="catalog-disclaimer">Conteúdo adulto e humor ofensivo.</p>
      {error ? <div className="banner error" role="alert"><span>{error}</span><button onClick={() => setAttempt(value => value + 1)}>Tentar novamente</button></div>
        : !catalog ? <p className="waiting-message" role="status">Carregando cartas…</p>
        : <>
          <div className="catalog-toolbar panel">
            <div className="mode-switch" role="group" aria-label="Tipo de carta">
              <button type="button" aria-pressed={type === "responses"} onClick={() => { setType("responses"); setPage(1); }}>Respostas ({catalog.responses.length})</button>
              <button type="button" aria-pressed={type === "prompts"} onClick={() => { setType("prompts"); setPage(1); }}>Perguntas / prompts ({catalog.prompts.length})</button>
            </div>
            <div className="catalog-filters">
              <div className="catalog-search"><label htmlFor="card-search">Buscar por texto ou ID</label><input id="card-search" type="search" enterKeyHint="search" placeholder="Digite para buscar uma carta…" value={query} onChange={event => { setQuery(event.target.value); setPage(1); }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} /></div>
              {type === "prompts" && <div><label htmlFor="pick-filter">Cartas por resposta</label><select id="pick-filter" value={pick} onChange={event => { setPick(event.target.value); setPage(1); }}><option value="all">Todas as perguntas</option><option value="1">Escolha 1 carta</option><option value="2">Escolha 2 cartas</option><option value="3">Escolha 3 cartas</option></select></div>}
            </div>
          </div>
          <div className="section-heading" ref={resultsRef}><h2>{type === "prompts" ? "Perguntas / prompts" : "Cartas de resposta"}</h2><span className="muted catalog-count" role="status">{filtered.length} carta(s) encontrada(s)</span></div>
          {visible.length ? <div className="catalog-grid">{visible.map(card => <article key={card.id} className={`catalog-card ${type === "prompts" ? "catalog-prompt" : "catalog-response"}`}>
            <div className="catalog-card-meta"><span>{type === "prompts" ? "PERGUNTA" : "RESPOSTA"}</span><span>{card.id}</span></div>
            <p>{card.text}</p>
            {"pick" in card && <div className="catalog-card-meta"><span>Escolha {card.pick}</span>{card.draw > 0 && <span>+{card.draw} cartas</span>}</div>}
          </article>)}</div> : <div className="panel waiting-message">Nenhuma carta encontrada. Tente outro texto ou filtro.</div>}
          <nav className="catalog-pagination" aria-label="Paginação das cartas">
            <button className="button secondary" disabled={page === 1} onClick={() => changePage(page - 1)}>← Anterior</button>
            <span>Página {page} de {pageCount}</span>
            <button className="button secondary" disabled={page >= pageCount} onClick={() => changePage(page + 1)}>Próxima →</button>
          </nav>
        </>}
    </main>
  </div>;
}
