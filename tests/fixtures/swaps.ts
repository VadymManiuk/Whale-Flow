import type { NormalizedSwap, SwapDirection } from "../../src/models/swap.js";
import type { ChainId } from "../../src/models/chain.js";

export function swapFixture(input: Partial<NormalizedSwap> & { timestamp: Date; direction?: SwapDirection; chain?: ChainId } ): NormalizedSwap {
  return {
    chain: input.chain ?? "base",
    txHash: input.txHash ?? `0xtx-${input.timestamp.getTime()}`,
    timestamp: input.timestamp,
    wallet: input.wallet ?? "0xWhale",
    tokenAddress: input.tokenAddress ?? "0xToken",
    tokenSymbol: input.tokenSymbol ?? "ESPORTS",
    direction: input.direction ?? "SELL",
    tokenAmount: input.tokenAmount ?? 100_000,
    usdValue: input.usdValue ?? 60_000,
    ...input
  };
}
