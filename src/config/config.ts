import "dotenv/config";
import { z } from "zod";

const optionalUrl = z.preprocess((value) => value === "" ? undefined : value, z.string().url().optional());
const optionalString = z.preprocess((value) => value === "" ? undefined : value, z.string().min(1).optional());
const booleanFromEnvironment = z.preprocess((value) => {
  if (value === undefined || value === "") return false;
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  TELEGRAM_BOT_TOKEN: optionalString,
  TELEGRAM_CHAT_ID: optionalString,
  ALCHEMY_ETHEREUM_RPC_URL: optionalUrl,
  ALCHEMY_BASE_RPC_URL: optionalUrl,
  BNB_RPC_URL: optionalUrl,
  HELIUS_API_KEY: optionalString,
  COINGECKO_DEMO_API_KEY: optionalString,
  DEXSCREENER_API_BASE: z.string().url().default("https://api.dexscreener.com"),
  BIRDEYE_API_KEY: optionalString,
  MIN_REPEATING_SWAPS: z.coerce.number().finite().int().min(3).default(3),
  MIN_WALLET_TOKEN_VALUE_USD: z.coerce.number().finite().nonnegative().default(1_000_000),
  MIN_WALLET_STABLE_OR_NATIVE_VALUE_USD: z.coerce.number().finite().nonnegative().default(1_000_000),
  MIN_INTERVAL_MINUTES: z.coerce.number().finite().nonnegative().default(2),
  MAX_INTERVAL_MINUTES: z.coerce.number().finite().positive().default(30),
  ROLLING_WINDOW_MINUTES: z.coerce.number().finite().positive().default(120),
  MIN_SWAP_USD_VALUE: z.coerce.number().finite().nonnegative().default(5_000),
  ALERT_COOLDOWN_MINUTES: z.coerce.number().finite().nonnegative().default(60),
  EVM_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(5).max(300).default(20),
  EVM_INITIAL_BLOCK_LOOKBACK: z.coerce.number().int().min(1).max(10).default(10),
  MIN_TOKEN_LIQUIDITY_USD: z.coerce.number().finite().nonnegative().default(0),
  SOLANA_POLL_INTERVAL_SECONDS: z.coerce.number().int().min(10).max(600).default(45),
  UNIVERSE_DISCOVERY_INTERVAL_MINUTES: z.coerce.number().int().min(15).max(1_440).default(360),
  MIN_TOKEN_MARKET_CAP_USD: z.coerce.number().finite().positive().default(5_000_000),
  DIP_BUYER_DETECTOR_ENABLED: booleanFromEnvironment
}).superRefine((value, context) => {
  if (value.MIN_INTERVAL_MINUTES > value.MAX_INTERVAL_MINUTES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "MIN_INTERVAL_MINUTES must be no greater than MAX_INTERVAL_MINUTES" });
  }
  if (Boolean(value.TELEGRAM_BOT_TOKEN) !== Boolean(value.TELEGRAM_CHAT_ID)) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: "TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID must be set together" });
  }
});

export type AppConfig = z.infer<typeof schema>;

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  return schema.parse(environment);
}
