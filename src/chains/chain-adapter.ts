import type { ChainId } from "../models/chain.js";
import type { NormalizedSwap } from "../models/swap.js";

export interface ChainAdapter {
  readonly chainId: ChainId;
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  getWalletTokenBalanceUsd(wallet: string, token: string): Promise<number | null>;
  getWalletStableAndNativeBalanceUsd(wallet: string): Promise<number | null>;
  normalizeSwap(raw: unknown): Promise<NormalizedSwap | null>;
}
