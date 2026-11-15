import { createLogger, logLevel } from "../../shared/logging";

export const logger = createLogger({
  level: logLevel(process.env.LOG_LEVEL, process.env.NODE_ENV === "test" ? "silent" : "info"),
  scope: "server",
});
