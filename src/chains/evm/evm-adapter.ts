import { createPublicClient, erc20Abi, formatEther, formatUnits, http, type Address, type PublicClient } from "viem";
import type { ChainAdapter } from "../chain-adapter.js";
import type { ChainId } from "../../models/chain.js";
import type { NormalizedSwap } from "../../models/swap.js";
import type { Logger } from "../../utils/logger.js";
import type { DexScreenerClient } from "../../integrations/price/dexscreener-client.js";

const stablecoins: Record<Extract<ChainId, "ethereum" | "base" | "bnb">, readonly Address[]> = {
  ethereum: ["0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "0xdAC17F958D2ee523a2206206994597C13D831ec7", "0x6B175474E89094C44Da98b954EedeAC495271d0F"],
  // Native USDC is the active Base stablecoin. The former USDbC address has no
  // contract bytecode on Base mainnet, so querying it makes every valuation fail.
  base: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  bnb: ["0x55d398326f99059fF775485246999027B3197955", "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d"]
};
const nativePriceToken: Record<Extract<ChainId, "ethereum" | "base" | "bnb">, Address> = {
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  base: "0x4200000000000000000000000000000000000006",
  bnb: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c"
};

/** Adapter for EVM wallet valuation; pool swap logs are decoded by EvmWatchlistPoller. */
export class EvmAdapter implements ChainAdapter {
  public readonly client: PublicClient | undefined;
  public constructor(
    public readonly chainId: Extract<ChainId, "ethereum" | "base" | "bnb">,
    public readonly name: string,
    rpcUrl: string | undefined,
    private readonly logger: Logger,
    private readonly prices: DexScreenerClient
  ) {
    // Live RPC is optional. Creating a viem transport with no URL throws during
    // application startup, while individual chains can remain disabled.
    this.client = rpcUrl ? createPublicClient({ transport: http(rpcUrl) }) : undefined;
  }

  public async start(): Promise<void> {
    this.logger.info({ chain: this.chainId, rpcConfigured: Boolean(this.client) }, "EVM wallet valuation is configured for live pool polling");
  }
  public async stop(): Promise<void> { this.logger.info({ chain: this.chainId }, "EVM adapter stopped"); }
  public async getWalletTokenBalanceUsd(wallet: string, token: string): Promise<number | null> {
    if (!this.client) return null;
    try {
      const [balance, decimals, market] = await Promise.all([
        this.client.readContract({ address: token as Address, abi: erc20Abi, functionName: "balanceOf", args: [wallet as Address] }),
        this.client.readContract({ address: token as Address, abi: erc20Abi, functionName: "decimals" }),
        this.prices.getTokenMarketData(this.chainId, token)
      ]);
      return market?.priceUsd === null || market === null ? null : Number(formatUnits(balance, decimals)) * market.priceUsd;
    } catch (error) {
      this.logger.warn({ err: error, chain: this.chainId, wallet, token }, "Unable to value EVM token balance");
      return null;
    }
  }
  public async getWalletStableAndNativeBalanceUsd(wallet: string): Promise<number | null> {
    if (!this.client) return null;
    try {
      const [nativeBalance, nativeMarket, stableBalances] = await Promise.all([
        this.client.getBalance({ address: wallet as Address }),
        this.prices.getTokenMarketData(this.chainId, nativePriceToken[this.chainId]),
        Promise.all(stablecoins[this.chainId].map(async (token) => {
          const [balance, decimals] = await Promise.all([
            this.client!.readContract({ address: token, abi: erc20Abi, functionName: "balanceOf", args: [wallet as Address] }),
            this.client!.readContract({ address: token, abi: erc20Abi, functionName: "decimals" })
          ]);
          return Number(formatUnits(balance, decimals));
        }))
      ]);
      const nativeUsd = nativeMarket?.priceUsd === null || nativeMarket === null ? 0 : Number(formatEther(nativeBalance)) * nativeMarket.priceUsd;
      return nativeUsd + stableBalances.reduce((sum, value) => sum + value, 0);
    } catch (error) {
      this.logger.warn({ err: error, chain: this.chainId, wallet }, "Unable to value EVM stable/native balance");
      return null;
    }
  }
  public async normalizeSwap(raw: unknown): Promise<NormalizedSwap | null> { void raw; return null; }
}
