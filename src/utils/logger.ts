import pino from "pino";

export function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    redact: ["TELEGRAM_BOT_TOKEN", "ALCHEMY_ETHEREUM_RPC_URL", "ALCHEMY_BASE_RPC_URL", "BNB_RPC_URL", "HELIUS_API_KEY", "BIRDEYE_API_KEY"]
  });
}

export type Logger = ReturnType<typeof createLogger>;
