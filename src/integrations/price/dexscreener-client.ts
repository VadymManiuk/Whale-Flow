import { z } from "zod";
import type { ChainId } from "../../models/chain.js";
import { withRetry } from "../../utils/retry.js";

const responseSchema = z.object({
  pairs: z.array(z.object({
    chainId: z.string(),
    pairAddress: z.string(),
    baseToken: z.object({ address: z.string(), symbol: z.string() }),
    quoteToken: z.object({ address: z.string(), symbol: z.string() }),
    priceUsd: z.string().optional(),
    liquidity: z.object({ usd: z.number().optional() }).optional(),
    marketCap: z.number().optional(),
    fdv: z.number().optional(),
    url: z.string().url().optional()
  })).nullable().optional()
});

export interface TokenMarketData {
  symbol: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  chartUrl?: string;
  poolAddress: string;
  quoteTokenAddress: string;
  quoteTokenSymbol: string;
}

export class DexScreenerClient {
  private readonly poolCache = new Map<string, { expiresAt: number; pools: TokenMarketData[] }>();
  public constructor(private readonly apiBase: string) {}
  public async getTokenMarketData(chain: ChainId, tokenAddress: string): Promise<TokenMarketData | null> {
    return (await this.getTokenPools(chain, tokenAddress))[0] ?? null;
  }
  public async getTokenPools(chain: ChainId, tokenAddress: string): Promise<TokenMarketData[]> {
    const cacheKey = `${chain}:${tokenAddress.toLowerCase()}`;
    const cached = this.poolCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.pools;
    const response = await withRetry(async () => fetch(`${this.apiBase}/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`));
    if (!response.ok) throw new Error(`DEX Screener returned HTTP ${response.status}`);
    const payload = responseSchema.parse(await response.json());
    const pairs = payload.pairs?.filter((item) => item.chainId === dexScreenerChainId(chain) && [item.baseToken.address, item.quoteToken.address].some((address) => address.toLowerCase() === tokenAddress.toLowerCase())) ?? [];
    const uniquePools = new Set<string>();
    const pools = pairs
      .sort((left, right) => (right.liquidity?.usd ?? 0) - (left.liquidity?.usd ?? 0))
      .filter((pair) => !uniquePools.has(pair.pairAddress.toLowerCase()) && (uniquePools.add(pair.pairAddress.toLowerCase()) || true))
      .map((pair) => {
        const trackedIsBase = pair.baseToken.address.toLowerCase() === tokenAddress.toLowerCase();
        return {
          symbol: trackedIsBase ? pair.baseToken.symbol : pair.quoteToken.symbol,
          priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
          liquidityUsd: pair.liquidity?.usd ?? null,
          marketCapUsd: pair.marketCap ?? pair.fdv ?? null,
          chartUrl: pair.url,
          poolAddress: pair.pairAddress,
          quoteTokenAddress: trackedIsBase ? pair.quoteToken.address : pair.baseToken.address,
          quoteTokenSymbol: trackedIsBase ? pair.quoteToken.symbol : pair.baseToken.symbol
        };
      });
    this.poolCache.set(cacheKey, { pools, expiresAt: Date.now() + 5 * 60_000 });
    return pools;
  }
}

function dexScreenerChainId(chain: ChainId): string {
  return chain === "bnb" ? "bsc" : chain;
}
