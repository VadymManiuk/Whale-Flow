import type { ChainAdapter } from "./chains/chain-adapter.js";
import { EvmAdapter } from "./chains/evm/evm-adapter.js";
import { SolanaAdapter } from "./chains/solana/solana-adapter.js";
import { loadConfig } from "./config/config.js";
import { createPrismaClient } from "./db/client.js";
import { AlertRepository, DexPoolRepository, SwapRepository, WatchlistRepository } from "./db/repositories.js";
import { GradualWhaleFlowDetector } from "./detectors/gradual-whale-flow-detector.js";
import { MemoryDetectorState } from "./detectors/memory-detector-state.js";
import { createTelegramNotifier } from "./integrations/telegram/telegram-notifier.js";
import type { ChainId } from "./models/chain.js";
import { createRedisClient } from "./services/redis-cache.js";
import { SwapProcessingService } from "./services/swap-processing-service.js";
import { AdapterWalletValueProvider } from "./services/wallet-value-provider.js";
import { createLogger } from "./utils/logger.js";
import { DexScreenerClient } from "./integrations/price/dexscreener-client.js";
import { EvmWatchlistPoller } from "./jobs/evm-watchlist-poller.js";
import { SolanaWalletPoller } from "./jobs/solana-wallet-poller.js";
import { CoinGeckoClient } from "./integrations/price/coingecko-client.js";
import { TokenUniverseDiscovery } from "./jobs/token-universe-discovery.js";
import { PoolCatalogRefresh } from "./jobs/pool-catalog-refresh.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger();
  const prisma = createPrismaClient();
  const redis = createRedisClient(config.REDIS_URL);
  const prices = new DexScreenerClient(config.DEXSCREENER_API_BASE);
  const adapters = new Map<ChainId, ChainAdapter>([
    ["ethereum", new EvmAdapter("ethereum", "Ethereum", config.ALCHEMY_ETHEREUM_RPC_URL, logger, prices)],
    ["base", new EvmAdapter("base", "Base", config.ALCHEMY_BASE_RPC_URL, logger, prices)],
    ["bnb", new EvmAdapter("bnb", "BNB Chain", config.BNB_RPC_URL, logger, prices)],
    ["solana", new SolanaAdapter(config.HELIUS_API_KEY, logger, prices)]
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
  const watchlists = new WatchlistRepository(prisma);
  const pools = new DexPoolRepository(prisma);
  const processor = new SwapProcessingService(new SwapRepository(prisma), detector, new AlertRepository(prisma), createTelegramNotifier(config), logger, config.ALERT_COOLDOWN_MINUTES);

  await prisma.$connect();
  await redis.ping();
  await Promise.all([...adapters.values()].map((adapter) => adapter.start()));
  const pollers: Array<{ stop(): void }> = (["ethereum", "base", "bnb"] as const).flatMap((chain) => {
    const adapter = adapters.get(chain);
    if (!(adapter instanceof EvmAdapter) || !adapter.client) return [];
    const poller = new EvmWatchlistPoller({
      chain,
      client: adapter.client,
      pools,
      processor,
      redis,
      logger,
      intervalSeconds: config.EVM_POLL_INTERVAL_SECONDS,
      batchSize: config.EVM_POOL_BATCH_SIZE,
      batchesPerCycle: config.EVM_BATCHES_PER_CYCLE,
      initialBlockLookback: config.EVM_INITIAL_BLOCK_LOOKBACK,
      minLiquidityUsd: config.MIN_TOKEN_LIQUIDITY_USD
    });
    poller.start();
    return [poller];
  });
  if (config.HELIUS_API_KEY) {
    const poller = new SolanaWalletPoller(config.HELIUS_API_KEY, watchlists, prices, processor, redis, logger, config.SOLANA_POLL_INTERVAL_SECONDS);
    poller.start();
    pollers.push(poller);
  }
  const catalogRefreshers = (["ethereum", "base", "bnb"] as const).map((chain) => new PoolCatalogRefresh(chain, watchlists, pools, prices, logger));
  catalogRefreshers.forEach((refresher) => refresher.start());
  const discovery = config.COINGECKO_DEMO_API_KEY
    ? new TokenUniverseDiscovery(new CoinGeckoClient(config.COINGECKO_DEMO_API_KEY), watchlists, logger, config.MIN_TOKEN_MARKET_CAP_USD, config.UNIVERSE_DISCOVERY_INTERVAL_MINUTES)
    : undefined;
  discovery?.start();
  logger.info({ adapters: adapters.size, pollers: pollers.length, discoveryEnabled: Boolean(discovery), telegramEnabled: Boolean(config.TELEGRAM_BOT_TOKEN) }, "Whale Flow started");

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Stopping Whale Flow");
    pollers.forEach((poller) => poller.stop());
    catalogRefreshers.forEach((refresher) => refresher.stop());
    discovery?.stop();
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
