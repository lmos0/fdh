import { createLogger, logLevel } from "../../../shared/logging";

function configuredLevel() {
  try {
    return logLevel(localStorage.getItem("fdh.logLevel") ?? undefined,
      import.meta.env.DEV ? "info" : "warn");
  } catch {
    return import.meta.env.DEV ? "info" as const : "warn" as const;
  }
}

export const logger = createLogger({ level: configuredLevel(), scope: "client" });
