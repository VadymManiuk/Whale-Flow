import type { Severity, WhaleAlert } from "../models/alert.js";
import { patternKey, swapIdentity, type NormalizedSwap } from "../models/swap.js";
import type { DetectionResult, DetectorConfig, DetectorState, WalletValueProvider } from "./types.js";

const MINUTE_MS = 60_000;

/**
 * Pure domain detector: adapters submit normalized swaps, while wallet valuation
 * is injected. This makes the detection rules testable without RPC/API calls.
 */
export class GradualWhaleFlowDetector {
  public constructor(
    private readonly config: DetectorConfig,
    private readonly state: DetectorState,
    private readonly walletValueProvider: WalletValueProvider
  ) {}

  public async process(swap: NormalizedSwap): Promise<DetectionResult> {
    const identity = swapIdentity(swap);
    if (this.state.hasSwap(identity)) return { alert: null, ignoredReason: "DUPLICATE_SWAP" };
    this.state.rememberSwap(identity);

    if (swap.usdValue === null || swap.usdValue < this.config.minSwapUsdValue) {
      return { alert: null, ignoredReason: "SWAP_VALUE_TOO_LOW" };
    }

    const key = patternKey(swap);
    const rollingCutoff = swap.timestamp.getTime() - this.config.rollingWindowMinutes * MINUTE_MS;
    const swaps = [...this.state.getSwaps(key), swap]
      .filter((item) => item.timestamp.getTime() >= rollingCutoff)
      .sort((left, right) => left.timestamp.getTime() - right.timestamp.getTime());
    this.state.setSwaps(key, swaps);

    const sequence = this.findLatestValidSequence(swaps);
    if (sequence.length < this.config.minRepeatingSwaps) return { alert: null, ignoredReason: "PATTERN_NOT_CONFIRMED" };

    const lastAlertAt = this.state.getLastAlertAt(key);
    if (lastAlertAt && swap.timestamp.getTime() - lastAlertAt.getTime() < this.config.alertCooldownMinutes * MINUTE_MS) {
      return { alert: null, ignoredReason: "COOLDOWN" };
    }

    const walletValues = await this.walletValueProvider.getWalletValues({
      chain: swap.chain,
      wallet: swap.wallet,
      tokenAddress: swap.tokenAddress
    });
    const qualifyingValue = swap.direction === "SELL" ? walletValues.tokenBalanceUsd : walletValues.stableAndNativeBalanceUsd;
    const threshold = swap.direction === "SELL" ? this.config.minWalletTokenValueUsd : this.config.minWalletStableOrNativeValueUsd;
    if (qualifyingValue === null || qualifyingValue < threshold) {
      return { alert: null, ignoredReason: "WALLET_VALUE_BELOW_THRESHOLD" };
    }

    const alert = this.toAlert(sequence, walletValues);
    this.state.setLastAlertAt(key, swap.timestamp);
    return { alert };
  }

  private findLatestValidSequence(swaps: NormalizedSwap[]): NormalizedSwap[] {
    if (swaps.length === 0) return [];
    const sequence = [swaps.at(-1)!];
    for (let index = swaps.length - 2; index >= 0; index -= 1) {
      const previous = swaps[index];
      const following = sequence[0];
      const interval = (following.timestamp.getTime() - previous.timestamp.getTime()) / MINUTE_MS;
      if (interval < this.config.minIntervalMinutes || interval > this.config.maxIntervalMinutes) break;
      sequence.unshift(previous);
    }
    return sequence;
  }

  private toAlert(sequence: NormalizedSwap[], values: { tokenBalanceUsd: number | null; stableAndNativeBalanceUsd: number | null }): WhaleAlert {
    const firstSwap = sequence[0];
    const latestSwap = sequence.at(-1)!;
    const intervals = sequence.slice(1).map((item, index) => (item.timestamp.getTime() - sequence[index].timestamp.getTime()) / MINUTE_MS);
    const totalUsdValue = sequence.reduce((sum, item) => sum + (item.usdValue ?? 0), 0);
    const balance = latestSwap.direction === "SELL" ? values.tokenBalanceUsd : values.stableAndNativeBalanceUsd;

    return {
      type: "GRADUAL_WHALE_FLOW",
      chain: latestSwap.chain,
      wallet: latestSwap.wallet,
      tokenAddress: latestSwap.tokenAddress,
      tokenSymbol: latestSwap.tokenSymbol,
      direction: latestSwap.direction,
      severity: severityFor(sequence.length, totalUsdValue, balance),
      confidence: sequence.every((item) => item.usdValue !== null) ? "HIGH" : "LOW",
      swapsCount: sequence.length,
      totalUsdValue,
      averageIntervalMinutes: intervals.reduce((sum, value) => sum + value, 0) / intervals.length,
      firstSwapAt: firstSwap.timestamp,
      lastSwapAt: latestSwap.timestamp,
      remainingTokenBalanceUsd: values.tokenBalanceUsd,
      remainingStableAndNativeBalanceUsd: values.stableAndNativeBalanceUsd,
      transactionHash: latestSwap.txHash
    };
  }
}

function severityFor(swapsCount: number, totalUsdValue: number, walletValue: number | null): Severity {
  if (swapsCount >= 4 && walletValue !== null && walletValue >= 1_000_000 && totalUsdValue >= 100_000) return "HIGH";
  if (walletValue !== null && walletValue >= 1_000_000 && totalUsdValue >= 100_000) return "HIGH";
  if (totalUsdValue >= 50_000) return "MEDIUM";
  return "LOW";
}
