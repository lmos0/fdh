import { loadCatalog } from "./cards";
import { startServer } from "./connections";
import { isIntegerInRange } from "./guards";
import { logger } from "./logger";

const DEFAULT_PORT = 3000;
const PORT_RANGE = { min: 1, max: 65_535 } as const;

try {
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!isIntegerInRange(port, PORT_RANGE)) throw new Error("PORT inválida.");
  const startedAt = performance.now();
  const catalog = await loadCatalog();
  logger.info("catalog.loaded", { promptCount: catalog.promptIds.length,
    responseCount: catalog.responseIds.length, durationMs: Math.round(performance.now() - startedAt) });
  const app = startServer({ catalog, port,
    publicOrigin: process.env.PUBLIC_ORIGIN ?? process.env.RENDER_EXTERNAL_URL });

  let stopping = false;
  async function shutdown(signal: string): Promise<void> {
    if (stopping) return;
    stopping = true;
    logger.info("process.signal_received", { signal });
    try {
      await app.stop();
      process.exit(0);
    } catch (error) {
      logger.error("server.shutdown_failed", {}, error);
      process.exit(1);
    }
  }
  process.on("SIGTERM", () => { void shutdown("SIGTERM"); });
  process.on("SIGINT", () => { void shutdown("SIGINT"); });
} catch (error) {
  logger.error("server.startup_failed", {}, error);
  process.exit(1);
}
