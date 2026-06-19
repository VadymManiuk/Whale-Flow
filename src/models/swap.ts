import type { ChainId } from "./chain.js";

export type SwapDirection = "BUY" | "SELL";

export interface NormalizedSwap {
  chain: ChainId;
  txHash: string;
  blockNumber?: number;
  slot?: number;
  timestamp: Date;
  wallet: string;
  tokenAddress: string;
  tokenSymbol?: string;
  tokenName?: string;
  direction: SwapDirection;
  tokenAmount: number;
  usdValue: number | null;
  quoteTokenAddress?: string;
  quoteTokenSymbol?: string;
  dexName?: string;
  poolAddress?: string;
  priceUsd?: number | null;
}

export function swapIdentity(swap: NormalizedSwap): string {
  return [swap.chain, swap.txHash, swap.wallet.toLowerCase(), swap.tokenAddress.toLowerCase(), swap.direction].join(":");
}

export function patternKey(swap: NormalizedSwap): string {
  return [swap.chain, swap.wallet.toLowerCase(), swap.tokenAddress.toLowerCase(), swap.direction].join(":");
}
