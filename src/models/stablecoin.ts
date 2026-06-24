import type { NormalizedSwap } from "./swap.js";

// Symbols are used because the monitored universe spans EVM and Solana. The
// filter affects alerts only; every raw swap is still persisted for auditing.
const STABLECOIN_SYMBOLS = new Set([
  "USDC", "USDBC", "USDT", "DAI", "USDE", "USDS", "FDUSD", "EURC",
  "PYUSD", "FRAX", "GHO", "LUSD", "CRVUSD", "USDD", "USD0"
]);

export function isStablecoinBuy(swap: NormalizedSwap): boolean {
  return swap.direction === "BUY" && STABLECOIN_SYMBOLS.has(swap.tokenSymbol?.trim().toUpperCase() ?? "");
}
