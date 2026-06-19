import type { ChainId } from "./chain.js";
import type { SwapDirection } from "./swap.js";

export type Severity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type Confidence = "HIGH" | "LOW";

export interface WhaleAlert {
  type: "GRADUAL_WHALE_FLOW";
  chain: ChainId;
  wallet: string;
  tokenAddress: string;
  tokenSymbol?: string;
  direction: SwapDirection;
  severity: Severity;
  confidence: Confidence;
  swapsCount: number;
  totalUsdValue: number;
  averageIntervalMinutes: number;
  firstSwapAt: Date;
  lastSwapAt: Date;
  remainingTokenBalanceUsd: number | null;
  remainingStableAndNativeBalanceUsd: number | null;
  transactionHash: string;
  tokenLiquidityUsd?: number | null;
  tokenMarketCapUsd?: number | null;
  chartUrl?: string;
}
