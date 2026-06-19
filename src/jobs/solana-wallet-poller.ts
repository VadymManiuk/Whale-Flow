import { z } from "zod";
import type { Redis } from "ioredis";
import type { WatchlistRepository } from "../db/repositories.js";
import type { DexScreenerClient } from "../integrations/price/dexscreener-client.js";
import type { SwapProcessingService } from "../services/swap-processing-service.js";
import type { Logger } from "../utils/logger.js";
import { withRetry } from "../utils/retry.js";

const responseSchema = z.array(z.object({
  signature: z.string(),
  timestamp: z.number().optional(),
  slot: z.number().optional(),
  type: z.string().optional(),
  tokenTransfers: z.array(z.object({
    fromUserAccount: z.string().nullable().optional(),
    toUserAccount: z.string().nullable().optional(),
    mint: z.string(),
    tokenAmount: z.number()
  })).optional()
}));

/** Polls Helius enhanced transactions for explicitly watched Solana wallets. */
export class SolanaWalletPoller {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  public constructor(
    private readonly apiKey: string,
    private readonly watchlists: WatchlistRepository,
    private readonly prices: DexScreenerClient,
    private readonly processor: SwapProcessingService,
    private readonly redis: Redis,
    private readonly logger: Logger,
    private readonly intervalSeconds: number
  ) {}
  public start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.intervalSeconds * 1_000);
  }
  public stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const [wallets, tokens] = await Promise.all([this.watchlists.listEnabledWallets("solana"), this.watchlists.listEnabledTokens("solana")]);
      const watchedTokens = new Set(tokens.map((token) => token.address));
      for (const wallet of wallets) await this.pollWallet(wallet.wallet, watchedTokens);
    } catch (error) {
      this.logger.error({ err: error }, "Solana watchlist polling failed");
    } finally { this.running = false; }
  }
  private async pollWallet(wallet: string, watchedTokens: ReadonlySet<string>): Promise<void> {
    const cursorKey = `whale-flow:cursor:solana:${wallet}`;
    const cursor = await this.redis.get(cursorKey);
    const response = await withRetry(() => fetch(`https://api.helius.xyz/v0/addresses/${encodeURIComponent(wallet)}/transactions?api-key=${encodeURIComponent(this.apiKey)}&limit=100`));
    if (!response.ok) throw new Error(`Helius returned HTTP ${response.status}`);
    const transactions = responseSchema.parse(await response.json());
    for (const transaction of transactions) {
      if (transaction.signature === cursor) break;
      if (transaction.type !== "SWAP") continue;
      for (const transfer of transaction.tokenTransfers ?? []) {
        if (!watchedTokens.has(transfer.mint)) continue;
        const direction = transfer.toUserAccount === wallet ? "BUY" : transfer.fromUserAccount === wallet ? "SELL" : null;
        if (!direction) continue;
        const market = await this.prices.getTokenMarketData("solana", transfer.mint);
        await this.processor.process({
          chain: "solana",
          txHash: transaction.signature,
          slot: transaction.slot,
          timestamp: new Date((transaction.timestamp ?? Math.floor(Date.now() / 1_000)) * 1_000),
          wallet,
          tokenAddress: transfer.mint,
          tokenSymbol: market?.symbol,
          direction,
          tokenAmount: transfer.tokenAmount,
          usdValue: market?.priceUsd === null || market === null ? null : transfer.tokenAmount * market.priceUsd,
          quoteTokenAddress: market?.quoteTokenAddress,
          quoteTokenSymbol: market?.quoteTokenSymbol,
          dexName: "Helius enhanced transaction",
          poolAddress: market?.poolAddress,
          priceUsd: market?.priceUsd
        });
      }
    }
    if (transactions[0]) await this.redis.set(cursorKey, transactions[0].signature, "EX", 86_400);
  }
}
