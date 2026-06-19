import type { WhaleAlert } from "../models/alert.js";
import type { ChainId } from "../models/chain.js";
import type { NormalizedSwap } from "../models/swap.js";

export interface DetectorConfig {
  minRepeatingSwaps: number;
  minWalletTokenValueUsd: number;
  minWalletStableOrNativeValueUsd: number;
  minIntervalMinutes: number;
  maxIntervalMinutes: number;
  rollingWindowMinutes: number;
  minSwapUsdValue: number;
  alertCooldownMinutes: number;
}

export interface WalletValueSnapshot {
  tokenBalanceUsd: number | null;
  stableAndNativeBalanceUsd: number | null;
}

export interface WalletValueProvider {
  getWalletValues(input: { chain: ChainId; wallet: string; tokenAddress: string }): Promise<WalletValueSnapshot>;
}

export interface DetectorState {
  hasSwap(identity: string): boolean;
  rememberSwap(identity: string): void;
  getSwaps(key: string): NormalizedSwap[];
  setSwaps(key: string, swaps: NormalizedSwap[]): void;
  getLastAlertAt(key: string): Date | undefined;
  setLastAlertAt(key: string, date: Date): void;
}

export interface DetectionResult {
  alert: WhaleAlert | null;
  ignoredReason?: "DUPLICATE_SWAP" | "SWAP_VALUE_TOO_LOW" | "PATTERN_NOT_CONFIRMED" | "COOLDOWN" | "WALLET_VALUE_BELOW_THRESHOLD";
}
