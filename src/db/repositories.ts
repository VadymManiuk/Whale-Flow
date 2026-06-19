import type { PrismaClient } from "@prisma/client";
import type { WhaleAlert } from "../models/alert.js";
import type { ChainId } from "../models/chain.js";
import type { NormalizedSwap } from "../models/swap.js";

export class SwapRepository {
  public constructor(private readonly prisma: PrismaClient) {}
  public async createIfNew(swap: NormalizedSwap): Promise<boolean> {
    try {
      await this.prisma.swap.create({
        data: {
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
        }
      });
      return true;
    } catch (error) {
      if (isPrismaUniqueViolation(error)) return false;
      throw error;
    }
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
}

export class WatchlistRepository {
  public constructor(private readonly prisma: PrismaClient) {}
  public async addToken(input: { chain: ChainId; address: string; symbol?: string; autoDiscovered?: boolean }): Promise<void> {
    await this.prisma.watchlistToken.upsert({
      where: { chain_tokenAddress: { chain: input.chain, tokenAddress: input.address } },
      create: { chain: input.chain, tokenAddress: input.address, symbol: input.symbol, autoDiscovered: input.autoDiscovered ?? false },
      update: { symbol: input.symbol, enabled: true, autoDiscovered: input.autoDiscovered ?? false }
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

function isPrismaUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
