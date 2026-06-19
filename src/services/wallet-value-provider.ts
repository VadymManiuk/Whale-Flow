import type { ChainAdapter } from "../chains/chain-adapter.js";
import type { WalletValueProvider, WalletValueSnapshot } from "../detectors/types.js";
import type { ChainId } from "../models/chain.js";

export class AdapterWalletValueProvider implements WalletValueProvider {
  public constructor(private readonly adapters: ReadonlyMap<ChainId, ChainAdapter>) {}
  public async getWalletValues(input: { chain: ChainId; wallet: string; tokenAddress: string }): Promise<WalletValueSnapshot> {
    const adapter = this.adapters.get(input.chain);
    if (!adapter) throw new Error(`No adapter registered for chain ${input.chain}`);
    const [tokenBalanceUsd, stableAndNativeBalanceUsd] = await Promise.all([
      adapter.getWalletTokenBalanceUsd(input.wallet, input.tokenAddress),
      adapter.getWalletStableAndNativeBalanceUsd(input.wallet)
    ]);
    return { tokenBalanceUsd, stableAndNativeBalanceUsd };
  }
}
