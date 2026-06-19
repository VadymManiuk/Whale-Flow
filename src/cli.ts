import { loadConfig } from "./config/config.js";
import { createPrismaClient } from "./db/client.js";
import { WatchlistRepository } from "./db/repositories.js";
import { createTelegramNotifier } from "./integrations/telegram/telegram-notifier.js";
import { isChainId } from "./models/chain.js";
import { createRedisClient } from "./services/redis-cache.js";

function argumentValue(argumentsList: string[], flag: string): string | undefined {
  const index = argumentsList.indexOf(flag);
  return index >= 0 ? argumentsList[index + 1] : undefined;
}

function requiredArgument(argumentsList: string[], flag: string): string {
  const value = argumentValue(argumentsList, flag);
  if (!value || value.startsWith("--")) throw new Error(`Missing required argument ${flag}`);
  return value;
}

async function main(): Promise<void> {
  const [command, ...argumentsList] = process.argv.slice(2);
  if (command === "start") {
    await import("./index.js");
    return;
  }
  const config = loadConfig();

  if (command === "telegram:test") {
    const id = await createTelegramNotifier(config).sendTestMessage();
    console.log(`Telegram test message sent (message id ${id}).`);
    return;
  }
  if (command === "health") {
    const prisma = createPrismaClient();
    const redis = createRedisClient(config.REDIS_URL);
    try {
      await prisma.$queryRaw`SELECT 1`;
      await redis.ping();
      console.log("Health check passed: PostgreSQL and Redis are reachable.");
    } finally {
      await redis.quit();
      await prisma.$disconnect();
    }
    return;
  }
  if (command === "token:add" || command === "wallet:add") {
    const chain = requiredArgument(argumentsList, "--chain");
    if (!isChainId(chain)) throw new Error(`Unsupported chain '${chain}'. Use ethereum, base, bnb, or solana.`);
    const prisma = createPrismaClient();
    try {
      const repository = new WatchlistRepository(prisma);
      if (command === "token:add") {
        const address = requiredArgument(argumentsList, "--address");
        await repository.addToken({ chain, address, symbol: argumentValue(argumentsList, "--symbol") });
        console.log(`Watchlist token saved: ${chain} ${address}`);
      } else {
        const wallet = requiredArgument(argumentsList, "--address");
        await repository.addWallet({ chain, wallet, label: argumentValue(argumentsList, "--label") });
        console.log(`Watchlist wallet saved: ${chain} ${wallet}`);
      }
    } finally {
      await prisma.$disconnect();
    }
    return;
  }
  throw new Error("Usage: pnpm bot <token:add|wallet:add|telegram:test|health>");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
