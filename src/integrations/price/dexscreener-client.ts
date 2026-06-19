import { z } from "zod";
import type { ChainId } from "../../models/chain.js";
import { withRetry } from "../../utils/retry.js";

const responseSchema = z.object({
  pairs: z.array(z.object({
    chainId: z.string(),
    baseToken: z.object({ address: z.string(), symbol: z.string() }),
    priceUsd: z.string().optional(),
    liquidity: z.object({ usd: z.number().optional() }).optional(),
    marketCap: z.number().optional(),
    fdv: z.number().optional(),
    url: z.string().url().optional()
  })).optional()
});

export interface TokenMarketData {
  symbol: string;
  priceUsd: number | null;
  liquidityUsd: number | null;
  marketCapUsd: number | null;
  chartUrl?: string;
}

export class DexScreenerClient {
  public constructor(private readonly apiBase: string) {}
  public async getTokenMarketData(chain: ChainId, tokenAddress: string): Promise<TokenMarketData | null> {
    const response = await withRetry(async () => fetch(`${this.apiBase}/latest/dex/tokens/${encodeURIComponent(tokenAddress)}`));
    if (!response.ok) throw new Error(`DEX Screener returned HTTP ${response.status}`);
    const payload = responseSchema.parse(await response.json());
    const pair = payload.pairs?.find((item) => item.chainId === dexScreenerChainId(chain) && item.baseToken.address.toLowerCase() === tokenAddress.toLowerCase()) ?? payload.pairs?.[0];
    if (!pair) return null;
    return {
      symbol: pair.baseToken.symbol,
      priceUsd: pair.priceUsd ? Number(pair.priceUsd) : null,
      liquidityUsd: pair.liquidity?.usd ?? null,
      marketCapUsd: pair.marketCap ?? pair.fdv ?? null,
      chartUrl: pair.url
    };
  }
}

function dexScreenerChainId(chain: ChainId): string {
  return chain === "bnb" ? "bsc" : chain;
}
