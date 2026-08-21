import pino from "pino";

// Pretty-printed in dev (no NODE_ENV=production set), plain JSON lines
// in production — JSON is what you actually want piped into a log
// aggregator, pretty-printing is only for a human staring at a terminal.
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
});
