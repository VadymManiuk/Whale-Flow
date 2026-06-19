import type { WatchlistRepository } from "../db/repositories.js";
import type { CoinGeckoClient } from "../integrations/price/coingecko-client.js";
import type { Logger } from "../utils/logger.js";

/** Keeps the watchlist aligned with CoinGecko's top market-cap token universe. */
export class TokenUniverseDiscovery {
  private timer: NodeJS.Timeout | undefined;
  public constructor(private readonly client: CoinGeckoClient, private readonly watchlists: WatchlistRepository, private readonly logger: Logger, private readonly minMarketCapUsd: number, private readonly intervalMinutes: number) {}
  public start(): void {
    if (this.timer) return;
    void this.run();
    this.timer = setInterval(() => void this.run(), this.intervalMinutes * 60_000);
  }
  public stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async run(): Promise<void> {
    try {
      const tokens = await this.client.discoverTokens(this.minMarketCapUsd);
      await Promise.all(tokens.map((token) => this.watchlists.addToken(token)));
      this.logger.info({ discoveredTokens: tokens.length, minMarketCapUsd: this.minMarketCapUsd }, "Token universe discovery completed");
    } catch (error) {
      this.logger.error({ err: error }, "Token universe discovery failed");
    }
  }
}
