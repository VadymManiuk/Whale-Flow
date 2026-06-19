import { z } from "zod";
import { withRetry } from "../../utils/retry.js";
import type { ChainId } from "../../models/chain.js";

const marketSchema = z.array(z.object({ id: z.string(), market_cap: z.number().nullable() }));
const coinListSchema = z.array(z.object({ id: z.string(), platforms: z.record(z.string(), z.string()) }));

const platformByChain: Record<ChainId, string> = {
  ethereum: "ethereum",
  base: "base",
  bnb: "binance-smart-chain",
  solana: "solana"
};

export interface DiscoveredToken { chain: ChainId; address: string; }

export class CoinGeckoClient {
  public constructor(private readonly apiKey: string) {}
  public async discoverTokens(minMarketCapUsd: number): Promise<DiscoveredToken[]> {
    const headers = { "x-cg-demo-api-key": this.apiKey };
    const [markets, coins] = await Promise.all([this.getMarketsAboveCap(minMarketCapUsd, headers), this.getJson("/coins/list?include_platform=true", headers, coinListSchema)]);
    const eligibleIds = new Set(markets.filter((coin) => (coin.market_cap ?? 0) >= minMarketCapUsd).map((coin) => coin.id));
    const seen = new Set<string>();
    const tokens: DiscoveredToken[] = [];
    for (const coin of coins) {
      if (!eligibleIds.has(coin.id)) continue;
      for (const [chain, platform] of Object.entries(platformByChain) as Array<[ChainId, string]>) {
        const address = coin.platforms[platform];
        if (!address) continue;
        const key = `${chain}:${address.toLowerCase()}`;
        if (!seen.has(key)) { seen.add(key); tokens.push({ chain, address }); }
      }
    }
    return tokens;
  }
  private async getMarketsAboveCap(minMarketCapUsd: number, headers: HeadersInit): Promise<Array<{ id: string; market_cap: number | null }>> {
    const markets: Array<{ id: string; market_cap: number | null }> = [];
    for (let page = 1; page <= 20; page += 1) {
      const result = await this.getJson(`/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=250&page=${page}&sparkline=false`, headers, marketSchema);
      markets.push(...result);
      if (result.length < 250 || (result.at(-1)?.market_cap ?? 0) < minMarketCapUsd) break;
    }
    return markets;
  }
  private async getJson<T>(path: string, headers: HeadersInit, schema: z.ZodType<T>): Promise<T> {
    const response = await withRetry(() => fetch(`https://api.coingecko.com/api/v3${path}`, { headers }));
    if (!response.ok) throw new Error(`CoinGecko returned HTTP ${response.status}`);
    return schema.parse(await response.json());
  }
}
