import type { NormalizedSwap } from "../models/swap.js";
import type { DetectorState } from "./types.js";

export class MemoryDetectorState implements DetectorState {
  private readonly swapIdentities = new Set<string>();
  private readonly groups = new Map<string, NormalizedSwap[]>();
  private readonly alerts = new Map<string, Date>();

  hasSwap(identity: string): boolean { return this.swapIdentities.has(identity); }
  rememberSwap(identity: string): void { this.swapIdentities.add(identity); }
  getSwaps(key: string): NormalizedSwap[] { return this.groups.get(key) ?? []; }
  setSwaps(key: string, swaps: NormalizedSwap[]): void { this.groups.set(key, swaps); }
  getLastAlertAt(key: string): Date | undefined { return this.alerts.get(key); }
  setLastAlertAt(key: string, date: Date): void { this.alerts.set(key, date); }
}
