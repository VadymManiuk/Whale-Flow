import type { ChainAdapter } from "../chain-adapter.js";
import type { NormalizedSwap } from "../../models/swap.js";
import type { Logger } from "../../utils/logger.js";
import { z } from "zod";
import type { DexScreenerClient } from "../../integrations/price/dexscreener-client.js";

const LAMPORTS_PER_SOL = 1_000_000_000;
const WRAPPED_SOL_MINT = "So11111111111111111111111111111111111111112";
const STABLE_MINTS = [
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEG3WeYv4fEZ",
  "Es9vMFrzaCERmJfrF4H2FYDqA84PZ3d3kJkuL78zM4dZ"
] as const;

const rpcEnvelopeSchema = z.object({
  result: z.unknown().optional(),
  error: z.object({ message: z.string() }).optional()
});
const balanceResultSchema = z.object({ value: z.number() });
const tokenAccountsResultSchema = z.object({
  value: z.array(z.object({
    account: z.object({
      data: z.object({
        parsed: z.object({
          info: z.object({
            tokenAmount: z.object({ uiAmount: z.number().nullable().optional() })
          })
        })
      })
    })
  }))
});

/** Helius-backed balance adapter used by the explicit Solana wallet poller. */
export class SolanaAdapter implements ChainAdapter {
  public readonly chainId = "solana" as const;
  public readonly name = "Solana";
  public constructor(
    private readonly heliusApiKey: string | undefined,
    private readonly logger: Logger,
    private readonly prices: DexScreenerClient
  ) {}
  public async start(): Promise<void> {
    this.logger.info({ configured: Boolean(this.heliusApiKey) }, "Solana wallet valuation is configured for the explicit wallet poller");
  }
  public async stop(): Promise<void> { this.logger.info("Solana adapter stopped"); }
  public async getWalletTokenBalanceUsd(wallet: string, token: string): Promise<number | null> {
    if (!this.heliusApiKey) return null;
    try {
      const [balance, market] = await Promise.all([this.tokenBalance(wallet, token), this.prices.getTokenMarketData("solana", token)]);
      return market?.priceUsd === null || market === null ? null : balance * market.priceUsd;
    } catch (error) {
      this.logger.warn({ err: error, wallet, token }, "Unable to value Solana token balance");
      return null;
    }
  }
  public async getWalletStableAndNativeBalanceUsd(wallet: string): Promise<number | null> {
    if (!this.heliusApiKey) return null;
    try {
      const [lamports, nativeMarket, stableBalances] = await Promise.all([
        this.rpc("getBalance", [wallet]).then((result) => balanceResultSchema.parse(result).value),
        this.prices.getTokenMarketData("solana", WRAPPED_SOL_MINT),
        Promise.all(STABLE_MINTS.map((mint) => this.tokenBalance(wallet, mint)))
      ]);
      const nativeUsd = nativeMarket?.priceUsd === null || nativeMarket === null ? 0 : (lamports / LAMPORTS_PER_SOL) * nativeMarket.priceUsd;
      return nativeUsd + stableBalances.reduce((total, balance) => total + balance, 0);
    } catch (error) {
      this.logger.warn({ err: error, wallet }, "Unable to value Solana stable/native balance");
      return null;
    }
  }
  public async normalizeSwap(raw: unknown): Promise<NormalizedSwap | null> { void raw; return null; }
  private async tokenBalance(wallet: string, mint: string): Promise<number> {
    const result = await this.rpc("getTokenAccountsByOwner", [wallet, { mint }, { encoding: "jsonParsed" }]);
    const accounts = tokenAccountsResultSchema.parse(result).value;
    return accounts.reduce((total, account) => total + (account.account.data.parsed.info.tokenAmount.uiAmount ?? 0), 0);
  }
  private async rpc(method: string, params: unknown[]): Promise<unknown> {
    if (!this.heliusApiKey) throw new Error("Helius API key is not configured");
    const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${encodeURIComponent(this.heliusApiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Helius RPC returned HTTP ${response.status}`);
    const body = rpcEnvelopeSchema.parse(await response.json());
    if (body.error) throw new Error(`Helius RPC ${method} failed: ${body.error.message}`);
    if (body.result === undefined) throw new Error(`Helius RPC ${method} returned no result`);
    return body.result;
  }
}
