import { createPublicClient, http, type PublicClient } from "viem";
import type { ChainAdapter } from "../chain-adapter.js";
import type { ChainId } from "../../models/chain.js";
import type { NormalizedSwap } from "../../models/swap.js";
import type { Logger } from "../../utils/logger.js";

/**
 * Adapter boundary for Ethereum, Base, and BNB. Swap log decoding is deliberately
 * not enabled yet: providers and pool selection must be configured per DEX.
 */
export class EvmAdapter implements ChainAdapter {
  public readonly client: PublicClient | undefined;
  public constructor(
    public readonly chainId: Extract<ChainId, "ethereum" | "base" | "bnb">,
    public readonly name: string,
    rpcUrl: string | undefined,
    private readonly logger: Logger
  ) {
    // Live RPC is optional while this adapter is a polling skeleton. Creating a
    // viem transport with no URL throws during application startup.
    this.client = rpcUrl ? createPublicClient({ transport: http(rpcUrl) }) : undefined;
  }

  public async start(): Promise<void> {
    this.logger.info({ chain: this.chainId, rpcConfigured: Boolean(this.client) }, "EVM adapter is configured as a watchlist polling skeleton; live DEX decoding is not enabled");
  }
  public async stop(): Promise<void> { this.logger.info({ chain: this.chainId }, "EVM adapter stopped"); }
  public async getWalletTokenBalanceUsd(wallet: string, token: string): Promise<number | null> { void wallet; void token; return null; }
  public async getWalletStableAndNativeBalanceUsd(wallet: string): Promise<number | null> { void wallet; return null; }
  public async normalizeSwap(raw: unknown): Promise<NormalizedSwap | null> { void raw; return null; }
}
