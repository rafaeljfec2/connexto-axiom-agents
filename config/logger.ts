import pino from "pino";

export const logger = pino({
  transport: {
    target: "pino/file",
    options: { destination: 1 },
  },
  level: process.env.LOG_LEVEL ?? "info",
});
