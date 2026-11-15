import { resolve, sep } from "node:path";
import type { CardCatalogView } from "../../shared/protocol";
import type { Catalog } from "./types";
import type { Logger } from "../../shared/logging";
import { logger as defaultLogger } from "./logger";

const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

export function createHttpHandler(catalog: Catalog, distDirectory = new URL("../../client/dist/", import.meta.url).pathname,
  logger: Logger = defaultLogger) {
  const root = resolve(distDirectory);
  // Apenas o catálogo editorial: não contém mãos, sessões ou estado de qualquer sala.
  const publicCatalog: CardCatalogView = {
    prompts: catalog.promptIds.map(id => {
      const card = catalog.cards.get(id)!;
      if (card.kind !== "prompt") throw new Error("Pergunta inválida no catálogo.");
      return { id: card.id, text: card.text, pick: card.pick, draw: card.draw };
    }),
    responses: catalog.responseIds.map(id => ({ id, text: catalog.cards.get(id)!.text })),
  };
  const catalogBody = JSON.stringify(publicCatalog);
  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" }, { headers: { ...securityHeaders, "Cache-Control": "no-store" } });
    }
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Método não permitido", { status: 405, headers: { ...securityHeaders, Allow: "GET, HEAD" } });
    }
    if (url.pathname === "/api/cards") {
      return new Response(request.method === "HEAD" ? null : catalogBody, { headers: {
        ...securityHeaders, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=60",
      } });
    }
    let pathname: string;
    try { pathname = decodeURIComponent(url.pathname); }
    catch { return new Response("Caminho inválido", { status: 400, headers: securityHeaders }); }
    const isIndex = pathname === "/" || pathname === "/index.html" || pathname === "/cards" || pathname === "/cards/";
    if (!isIndex && !pathname.startsWith("/assets/")) {
      return new Response("Não encontrado", { status: 404, headers: securityHeaders });
    }
    const filePath = resolve(root, isIndex ? "index.html" : pathname.slice(1));
    if (!filePath.startsWith(root + sep) || pathname.includes("\0")) {
      return new Response("Não encontrado", { status: 404, headers: securityHeaders });
    }
    const file = Bun.file(filePath);
    if (!await file.exists()) {
      return new Response(isIndex ? "Frontend não compilado. Execute bun run build ou use o Vite em desenvolvimento." : "Não encontrado", {
        status: isIndex ? 503 : 404, headers: securityHeaders,
      });
    }
    return new Response(request.method === "HEAD" ? null : file, { headers: {
      ...securityHeaders,
      "Content-Type": file.type,
      "Cache-Control": isIndex ? "no-cache" : "public, max-age=31536000, immutable",
    } });
  }

  return async (request: Request): Promise<Response> => {
    const startedAt = performance.now();
    const pathname = new URL(request.url).pathname;
    // Nunca registrar URL completa, query string, cabeçalhos ou caminhos arbitrários.
    const route = pathname === "/" || pathname === "/index.html" ? "/"
      : pathname === "/cards" || pathname === "/cards/" ? "/cards"
      : pathname === "/api/cards" || pathname === "/health" ? pathname
      : pathname.startsWith("/assets/") ? "/assets/*" : "unknown";
    try {
      const response = await handle(request);
      const fields = { method: request.method, route, status: response.status,
        durationMs: Math.round((performance.now() - startedAt) * 100) / 100 };
      if (response.status >= 500) logger.error("http.response", fields);
      else if (response.status >= 400 && route !== "unknown") logger.warn("http.response", fields);
      else if (route !== "/health") logger.debug("http.response", fields);
      return response;
    } catch (error) {
      logger.error("http.failed", { method: request.method, route, status: 500 }, error);
      return new Response("Erro interno", { status: 500, headers: securityHeaders });
    }
  };
}
