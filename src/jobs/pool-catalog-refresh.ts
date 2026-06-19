import type { DexPoolRepository, WatchlistRepository } from "../db/repositories.js";
import type { DexScreenerClient } from "../integrations/price/dexscreener-client.js";
import type { ChainId } from "../models/chain.js";
import type { Logger } from "../utils/logger.js";

export class PoolCatalogRefresh {
  private timer: NodeJS.Timeout | undefined;
  public constructor(private readonly chain: Extract<ChainId, "ethereum" | "base" | "bnb">, private readonly watchlists: WatchlistRepository, private readonly pools: DexPoolRepository, private readonly prices: DexScreenerClient, private readonly logger: Logger) {}
  public start(): void { if (!this.timer) { void this.refresh(); this.timer = setInterval(() => void this.refresh(), 6 * 60 * 60_000); } }
  public stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async refresh(): Promise<void> {
    const tokens = await this.watchlists.listEnabledTokens(this.chain);
    for (const token of tokens) {
      try { for (const pool of await this.prices.getTokenPools(this.chain, token.address)) await this.pools.upsert(this.chain, token.address, pool); }
      catch (error) { this.logger.warn({ err: error, chain: this.chain, token: token.address }, "Pool catalog refresh skipped token"); }
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }
}
