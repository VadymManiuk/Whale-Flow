import { describe, expect, it } from "vitest";
import { isStablecoinBuy } from "../src/models/stablecoin.js";
import type { NormalizedSwap } from "../src/models/swap.js";

function swap(symbol: string, direction: "BUY" | "SELL"): NormalizedSwap {
  return {
    chain: "base",
    txHash: "0xtest",
    timestamp: new Date("2026-01-01T00:00:00Z"),
    wallet: "0xwallet",
    tokenAddress: "0xtoken",
    tokenSymbol: symbol,
    direction,
    tokenAmount: 1,
    usdValue: 1
  };
}

describe("stablecoin buy filter", () => {
  it("filters EURC and USDC buys", () => {
    expect(isStablecoinBuy(swap("EURC", "BUY"))).toBe(true);
    expect(isStablecoinBuy(swap("usdc", "BUY"))).toBe(true);
  });

  it("keeps stablecoin sells and non-stable buys eligible", () => {
    expect(isStablecoinBuy(swap("EURC", "SELL"))).toBe(false);
    expect(isStablecoinBuy(swap("WETH", "BUY"))).toBe(false);
  });
});
