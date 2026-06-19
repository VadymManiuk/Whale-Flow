export const chains = ["ethereum", "base", "bnb", "solana"] as const;

export type ChainId = (typeof chains)[number];

export function isChainId(value: string): value is ChainId {
  return (chains as readonly string[]).includes(value);
}
