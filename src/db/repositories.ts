import type { PrismaClient } from "@prisma/client";
import type { WhaleAlert } from "../models/alert.js";
import type { ChainId } from "../models/chain.js";
import type { NormalizedSwap } from "../models/swap.js";
import type { TokenMarketData } from "../integrations/price/dexscreener-client.js";

export class SwapRepository {
  public constructor(private readonly prisma: PrismaClient) {}
  public async createIfNew(swap: NormalizedSwap): Promise<boolean> {
    const result = await this.prisma.swap.createMany({
      data: [{
          chain: swap.chain,
          txHash: swap.txHash,
          blockNumber: swap.blockNumber,
          slot: swap.slot,
          timestamp: swap.timestamp,
          wallet: swap.wallet,
          tokenAddress: swap.tokenAddress,
          tokenSymbol: swap.tokenSymbol,
          direction: swap.direction,
          tokenAmount: swap.tokenAmount,
          usdValue: swap.usdValue,
          quoteTokenAddress: swap.quoteTokenAddress,
          quoteTokenSymbol: swap.quoteTokenSymbol,
          dexName: swap.dexName,
          poolAddress: swap.poolAddress,
          priceUsd: swap.priceUsd
      }],
      skipDuplicates: true
    });
    return result.count === 1;
  }
}

export class AlertRepository {
  public constructor(private readonly prisma: PrismaClient) {}
  public async create(alert: WhaleAlert, message: string, telegramMessageId: string | null): Promise<void> {
    await this.prisma.alert.create({
      data: {
        type: alert.type,
        chain: alert.chain,
        wallet: alert.wallet,
        tokenAddress: alert.tokenAddress,
        tokenSymbol: alert.tokenSymbol,
        direction: alert.direction,
        severity: alert.severity,
        swapsCount: alert.swapsCount,
        totalUsdValue: alert.totalUsdValue,
        avgIntervalMinutes: alert.averageIntervalMinutes,
        firstSwapAt: alert.firstSwapAt,
        lastSwapAt: alert.lastSwapAt,
        message,
        telegramMessageId
      }
    });
  }
  public async existsSince(alert: WhaleAlert, since: Date): Promise<boolean> {
    const count = await this.prisma.alert.count({
      where: {
        type: alert.type,
        chain: alert.chain,
        wallet: alert.wallet,
        tokenAddress: alert.tokenAddress,
        direction: alert.direction,
        createdAt: { gte: since }
      }
    });
    return count > 0;
  }
}

export class WatchlistRepository {
  public constructor(private readonly prisma: PrismaClient) {}
  public async addToken(input: { chain: ChainId; address: string; symbol?: string; autoDiscovered?: boolean }): Promise<void> {
    const existing = await this.prisma.watchlistToken.findUnique({
      where: { chain_tokenAddress: { chain: input.chain, tokenAddress: input.address } },
      select: { autoDiscovered: true }
    });
    // A manually added token is pinned. A later CoinGecko refresh must not turn it
    // into an auto-discovered token that can be disabled when the universe changes.
    const autoDiscovered = input.autoDiscovered ? (existing?.autoDiscovered ?? true) : false;
    await this.prisma.watchlistToken.upsert({
      where: { chain_tokenAddress: { chain: input.chain, tokenAddress: input.address } },
      create: { chain: input.chain, tokenAddress: input.address, symbol: input.symbol, autoDiscovered },
      update: { symbol: input.symbol, enabled: true, autoDiscovered }
    });
  }
  public async addWallet(input: { chain: ChainId; wallet: string; label?: string }): Promise<void> {
    await this.prisma.watchlistWallet.upsert({
      where: { chain_wallet: { chain: input.chain, wallet: input.wallet } },
      create: { chain: input.chain, wallet: input.wallet, label: input.label },
      update: { label: input.label, enabled: true }
    });
  }
  public async listEnabledTokens(chain: ChainId): Promise<Array<{ address: string; symbol: string | null }>> {
    return this.prisma.watchlistToken.findMany({
      where: { chain, enabled: true },
      select: { tokenAddress: true, symbol: true }
    }).then((tokens) => tokens.map((token) => ({ address: token.tokenAddress, symbol: token.symbol })));
  }
  public async listEnabledWallets(chain: ChainId): Promise<Array<{ wallet: string; label: string | null }>> {
    return this.prisma.watchlistWallet.findMany({
      where: { chain, enabled: true },
      select: { wallet: true, label: true }
    });
  }
  public async disableStaleAutoDiscoveredTokens(tokens: ReadonlyArray<{ chain: ChainId; address: string }>): Promise<void> {
    const active = tokens.map((token) => ({ chain: token.chain, tokenAddress: token.address }));
    await this.prisma.watchlistToken.updateMany({
      where: active.length === 0 ? { autoDiscovered: true } : { autoDiscovered: true, NOT: { OR: active } },
      data: { enabled: false }
    });
  }
}

export class DexPoolRepository {
  public constructor(private readonly prisma: PrismaClient) {}
  public async upsert(chain: ChainId, tokenAddress: string, pool: TokenMarketData): Promise<void> {
    await this.prisma.dexPool.upsert({
      where: { chain_poolAddress_tokenAddress: { chain, poolAddress: pool.poolAddress, tokenAddress } },
      create: { chain, poolAddress: pool.poolAddress, tokenAddress, tokenSymbol: pool.symbol, quoteTokenAddress: pool.quoteTokenAddress, quoteTokenSymbol: pool.quoteTokenSymbol, priceUsd: pool.priceUsd, liquidityUsd: pool.liquidityUsd, chartUrl: pool.chartUrl },
      update: { tokenSymbol: pool.symbol, quoteTokenAddress: pool.quoteTokenAddress, quoteTokenSymbol: pool.quoteTokenSymbol, priceUsd: pool.priceUsd, liquidityUsd: pool.liquidityUsd, chartUrl: pool.chartUrl, enabled: true }
    });
  }
  public async listEnabled(chain: Extract<ChainId, "ethereum" | "base" | "bnb">): Promise<Array<{ tokenAddress: string; market: TokenMarketData }>> {
    const activeTokens = await this.prisma.watchlistToken.findMany({ where: { chain, enabled: true }, select: { tokenAddress: true } });
    if (activeTokens.length === 0) return [];
    const pools = await this.prisma.dexPool.findMany({
      where: { chain, enabled: true, tokenAddress: { in: activeTokens.map((token) => token.tokenAddress) } }
    });
    return pools.map((pool) => ({
      tokenAddress: pool.tokenAddress,
      market: {
        symbol: pool.tokenSymbol ?? pool.tokenAddress,
        priceUsd: pool.priceUsd,
        liquidityUsd: pool.liquidityUsd,
        marketCapUsd: null,
        chartUrl: pool.chartUrl ?? undefined,
        poolAddress: pool.poolAddress,
        quoteTokenAddress: pool.quoteTokenAddress ?? "",
        quoteTokenSymbol: pool.quoteTokenSymbol ?? ""
      }
    }));
  }
}
