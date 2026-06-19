import type { ChainAdapter } from "../chain-adapter.js";
import type { NormalizedSwap } from "../../models/swap.js";
import type { Logger } from "../../utils/logger.js";

/** Helius enhanced-transaction parsing is a production TODO; no fake events are emitted. */
export class SolanaAdapter implements ChainAdapter {
  public readonly chainId = "solana" as const;
  public readonly name = "Solana";
  public constructor(private readonly heliusApiKey: string | undefined, private readonly logger: Logger) {}
  public async start(): Promise<void> {
    this.logger.info({ configured: Boolean(this.heliusApiKey) }, "Solana adapter is a skeleton; live Helius ingestion is not enabled");
  }
  public async stop(): Promise<void> { this.logger.info("Solana adapter stopped"); }
  public async getWalletTokenBalanceUsd(wallet: string, token: string): Promise<number | null> { void wallet; void token; return null; }
  public async getWalletStableAndNativeBalanceUsd(wallet: string): Promise<number | null> { void wallet; return null; }
  public async normalizeSwap(raw: unknown): Promise<NormalizedSwap | null> { void raw; return null; }
}
