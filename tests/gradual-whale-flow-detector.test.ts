import { describe, expect, it } from "vitest";
import { GradualWhaleFlowDetector } from "../src/detectors/gradual-whale-flow-detector.js";
import { MemoryDetectorState } from "../src/detectors/memory-detector-state.js";
import type { WalletValueProvider } from "../src/detectors/types.js";
import { swapFixture } from "./fixtures/swaps.js";

const baseTime = new Date("2026-06-19T10:00:00.000Z");
const config = {
  minRepeatingSwaps: 3,
  minWalletTokenValueUsd: 1_000_000,
  minWalletStableOrNativeValueUsd: 1_000_000,
  minIntervalMinutes: 2,
  maxIntervalMinutes: 30,
  rollingWindowMinutes: 120,
  minSwapUsdValue: 5_000,
  alertCooldownMinutes: 60
};

function at(minutes: number): Date { return new Date(baseTime.getTime() + minutes * 60_000); }
function detector(values = { tokenBalanceUsd: 1_700_000, stableAndNativeBalanceUsd: 1_250_000 }) {
  const provider: WalletValueProvider = { getWalletValues: async () => values };
  return new GradualWhaleFlowDetector(config, new MemoryDetectorState(), provider);
}

describe("GradualWhaleFlowDetector", () => {
  it("alerts on three qualifying sells", async () => {
    const subject = detector();
    await subject.process(swapFixture({ timestamp: at(0) }));
    await subject.process(swapFixture({ timestamp: at(12) }));
    const result = await subject.process(swapFixture({ timestamp: at(25) }));
    expect(result.alert).toMatchObject({ direction: "SELL", swapsCount: 3, totalUsdValue: 180_000, severity: "HIGH" });
    expect(result.alert?.averageIntervalMinutes).toBe(12.5);
  });

  it("does not alert on only two sells", async () => {
    const subject = detector();
    await subject.process(swapFixture({ timestamp: at(0) }));
    const result = await subject.process(swapFixture({ timestamp: at(10) }));
    expect(result).toEqual({ alert: null, ignoredReason: "PATTERN_NOT_CONFIRMED" });
  });

  it("rejects a sequence with an interval above the configured maximum", async () => {
    const subject = detector();
    await subject.process(swapFixture({ timestamp: at(0) }));
    await subject.process(swapFixture({ timestamp: at(10) }));
    const result = await subject.process(swapFixture({ timestamp: at(45) }));
    expect(result.alert).toBeNull();
  });

  it("alerts on buys when stable/native value meets the threshold", async () => {
    const subject = detector({ tokenBalanceUsd: 760_000, stableAndNativeBalanceUsd: 1_250_000 });
    await subject.process(swapFixture({ timestamp: at(0), direction: "BUY" }));
    await subject.process(swapFixture({ timestamp: at(9), direction: "BUY" }));
    const result = await subject.process(swapFixture({ timestamp: at(18), direction: "BUY" }));
    expect(result.alert).toMatchObject({ direction: "BUY", swapsCount: 3 });
  });

  it("deduplicates an identical transaction", async () => {
    const subject = detector();
    const swap = swapFixture({ timestamp: at(0), txHash: "0xduplicate" });
    await subject.process(swap);
    const result = await subject.process(swap);
    expect(result).toEqual({ alert: null, ignoredReason: "DUPLICATE_SWAP" });
  });

  it("suppresses a confirmed repeat during cooldown", async () => {
    const subject = detector();
    await subject.process(swapFixture({ timestamp: at(0) }));
    await subject.process(swapFixture({ timestamp: at(10) }));
    await subject.process(swapFixture({ timestamp: at(20) }));
    const result = await subject.process(swapFixture({ timestamp: at(30) }));
    expect(result).toEqual({ alert: null, ignoredReason: "COOLDOWN" });
  });

  it("ignores low value swaps", async () => {
    const subject = detector();
    const result = await subject.process(swapFixture({ timestamp: at(0), usdValue: 4_999 }));
    expect(result).toEqual({ alert: null, ignoredReason: "SWAP_VALUE_TOO_LOW" });
  });

  it("keeps tokens, wallets, and directions in independent pattern groups", async () => {
    const subject = detector();
    await subject.process(swapFixture({ timestamp: at(0), tokenAddress: "0xA" }));
    await subject.process(swapFixture({ timestamp: at(10), tokenAddress: "0xB" }));
    await subject.process(swapFixture({ timestamp: at(20), wallet: "0xOther", tokenAddress: "0xA" }));
    const result = await subject.process(swapFixture({ timestamp: at(30), tokenAddress: "0xA", direction: "BUY" }));
    expect(result.alert).toBeNull();
  });
});
