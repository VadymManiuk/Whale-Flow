import pino from "pino";
import { sanitizeError } from "./sanitize-error.js";

export function createLogger() {
  return pino({
    level: process.env.LOG_LEVEL ?? "info",
    serializers: { err: sanitizeError },
    redact: [
      "TELEGRAM_BOT_TOKEN",
      "EVM_ETHEREUM_RPC_URLS",
      "EVM_BASE_RPC_URLS",
      "EVM_BNB_RPC_URLS",
      "ALCHEMY_ETHEREUM_RPC_URL",
      "ALCHEMY_BASE_RPC_URL",
      "BNB_RPC_URL",
      "HELIUS_API_KEY",
      "BIRDEYE_API_KEY"
    ]
  });
}

export type Logger = ReturnType<typeof createLogger>;
