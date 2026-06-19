import type { ChainAdapter } from "./chains/chain-adapter.js";
import { EvmAdapter } from "./chains/evm/evm-adapter.js";
import { SolanaAdapter } from "./chains/solana/solana-adapter.js";
import { loadConfig } from "./config/config.js";
import { createPrismaClient } from "./db/client.js";
import { AlertRepository, SwapRepository } from "./db/repositories.js";
import { GradualWhaleFlowDetector } from "./detectors/gradual-whale-flow-detector.js";
import { MemoryDetectorState } from "./detectors/memory-detector-state.js";
import { createTelegramNotifier } from "./integrations/telegram/telegram-notifier.js";
import type { ChainId } from "./models/chain.js";
import { createRedisClient } from "./services/redis-cache.js";
import { SwapProcessingService } from "./services/swap-processing-service.js";
import { AdapterWalletValueProvider } from "./services/wallet-value-provider.js";
import { createLogger } from "./utils/logger.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger();
  const prisma = createPrismaClient();
  const redis = createRedisClient(config.REDIS_URL);
  const adapters = new Map<ChainId, ChainAdapter>([
    ["ethereum", new EvmAdapter("ethereum", "Ethereum", config.ALCHEMY_ETHEREUM_RPC_URL, logger)],
    ["base", new EvmAdapter("base", "Base", config.ALCHEMY_BASE_RPC_URL, logger)],
    ["bnb", new EvmAdapter("bnb", "BNB Chain", config.BNB_RPC_URL, logger)],
    ["solana", new SolanaAdapter(config.HELIUS_API_KEY, logger)]
  ]);
  const detector = new GradualWhaleFlowDetector({
    minRepeatingSwaps: config.MIN_REPEATING_SWAPS,
    minWalletTokenValueUsd: config.MIN_WALLET_TOKEN_VALUE_USD,
    minWalletStableOrNativeValueUsd: config.MIN_WALLET_STABLE_OR_NATIVE_VALUE_USD,
    minIntervalMinutes: config.MIN_INTERVAL_MINUTES,
    maxIntervalMinutes: config.MAX_INTERVAL_MINUTES,
    rollingWindowMinutes: config.ROLLING_WINDOW_MINUTES,
    minSwapUsdValue: config.MIN_SWAP_USD_VALUE,
    alertCooldownMinutes: config.ALERT_COOLDOWN_MINUTES
  }, new MemoryDetectorState(), new AdapterWalletValueProvider(adapters));

  // The service is constructed here so an adapter can submit normalized swaps as
  // soon as live polling is implemented. It never signs or submits transactions.
  new SwapProcessingService(new SwapRepository(prisma), detector, new AlertRepository(prisma), createTelegramNotifier(config), logger);

  await prisma.$connect();
  await redis.ping();
  await Promise.all([...adapters.values()].map((adapter) => adapter.start()));
  logger.info({ adapters: adapters.size, telegramEnabled: Boolean(config.TELEGRAM_BOT_TOKEN) }, "Whale Flow started; live chain ingestion remains disabled until adapter implementations are configured");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Stopping Whale Flow");
    await Promise.all([...adapters.values()].map((adapter) => adapter.stop()));
    await redis.quit();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  createLogger().fatal({ err: error }, "Whale Flow failed to start");
  process.exitCode = 1;
});
