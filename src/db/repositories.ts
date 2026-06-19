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
  public async addToken(input: { chain: ChainId; address: string; symbol?: string }): Promise<void> {
    await this.prisma.watchlistToken.upsert({
      where: { chain_tokenAddress: { chain: input.chain, tokenAddress: input.address } },
      create: { chain: input.chain, tokenAddress: input.address, symbol: input.symbol },
      update: { symbol: input.symbol, enabled: true }
    });
  }
  public async addWallet(input: { chain: ChainId; wallet: string; label?: string }): Promise<void> {
    await this.prisma.watchlistWallet.upsert({
      where: { chain_wallet: { chain: input.chain, wallet: input.wallet } },
      create: { chain: input.chain, wallet: input.wallet, label: input.label },
      update: { label: input.label, enabled: true }
    });
  }
}

function isPrismaUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
