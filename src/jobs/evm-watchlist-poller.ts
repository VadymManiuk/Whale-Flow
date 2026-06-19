import { formatUnits, isAddress, parseAbiItem, type Address, type PublicClient } from "viem";
import type { Redis } from "ioredis";
import type { WatchlistRepository } from "../db/repositories.js";
import type { ChainId } from "../models/chain.js";
import type { NormalizedSwap } from "../models/swap.js";
import type { DexScreenerClient, TokenMarketData } from "../integrations/price/dexscreener-client.js";
import type { SwapProcessingService } from "../services/swap-processing-service.js";
import type { Logger } from "../utils/logger.js";

const v2Swap = parseAbiItem("event Swap(address indexed sender, uint256 amount0In, uint256 amount1In, uint256 amount0Out, uint256 amount1Out, address indexed to)");
const v3Swap = parseAbiItem("event Swap(address indexed sender, address indexed recipient, int256 amount0, int256 amount1, uint160 sqrtPriceX96, uint128 liquidity, int24 tick)");
const token0Abi = parseAbiItem("function token0() view returns (address)");
const token1Abi = parseAbiItem("function token1() view returns (address)");
const decimalsAbi = parseAbiItem("function decimals() view returns (uint8)");

interface PoolTarget { token: string; market: TokenMarketData; }
interface PoolGroup { pool: Address; targets: PoolTarget[]; }
interface PoolMetadata { token0: Address; token1: Address; }
interface LogBase { transactionHash?: `0x${string}`; blockNumber?: bigint; address: Address; }
interface V2Log extends LogBase { args: { amount0In?: bigint; amount1In?: bigint; amount0Out?: bigint; amount1Out?: bigint; }; }
interface V3Log extends LogBase { args: { amount0?: bigint; amount1?: bigint; }; }

export interface EvmPollerOptions {
  chain: Extract<ChainId, "ethereum" | "base" | "bnb">; client: PublicClient; watchlists: WatchlistRepository; prices: DexScreenerClient;
  processor: SwapProcessingService; redis: Redis; logger: Logger; intervalSeconds: number; initialBlockLookback: number; minLiquidityUsd: number; batchSize: number;
}

/** Batches pool addresses per event signature to stay within free-RPC limits. */
export class EvmWatchlistPoller {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private cooldownUntil = 0;
  private readonly metadata = new Map<string, PoolMetadata | null>();
  private readonly decimals = new Map<string, number | null>();
  public constructor(private readonly options: EvmPollerOptions) {}
  public start(): void { if (!this.timer) { void this.poll(); this.timer = setInterval(() => void this.poll(), this.options.intervalSeconds * 1_000); } }
  public stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async poll(): Promise<void> {
    if (this.running || Date.now() < this.cooldownUntil) return;
    this.running = true;
    try {
      const [tokens, latestBlock] = await Promise.all([this.options.watchlists.listEnabledTokens(this.options.chain), this.options.client.getBlockNumber()]);
      const groups = await this.groupsFor(tokens.map((token) => token.address));
      for (const batch of chunk(groups, this.options.batchSize)) await this.pollBatch(batch, latestBlock);
    } catch (error) {
      if (isRateLimited(error)) { this.cooldownUntil = Date.now() + 60_000; this.options.logger.warn({ chain: this.options.chain, cooldownSeconds: 60 }, "EVM RPC rate limited; scanner paused before retry"); }
      else this.options.logger.error({ err: error, chain: this.options.chain }, "EVM watchlist polling failed");
    } finally { this.running = false; }
  }
  private async groupsFor(tokens: string[]): Promise<PoolGroup[]> {
    const groups = new Map<string, PoolGroup>();
    for (const token of tokens) {
      if (!isAddress(token)) continue;
      try {
        for (const market of await this.options.prices.getTokenPools(this.options.chain, token)) {
          if (!isAddress(market.poolAddress) || (market.liquidityUsd ?? 0) < this.options.minLiquidityUsd) continue;
          const key = market.poolAddress.toLowerCase();
          const group = groups.get(key) ?? { pool: market.poolAddress as Address, targets: [] };
          group.targets.push({ token, market }); groups.set(key, group);
        }
      } catch (error) { this.options.logger.warn({ err: error, chain: this.options.chain, token }, "Skipping token with unavailable pool data"); }
    }
    return [...groups.values()];
  }
  private async pollBatch(groups: PoolGroup[], latestBlock: bigint): Promise<void> {
    const usable: Array<{ group: PoolGroup; metadata: PoolMetadata }> = [];
    for (const group of groups) {
      const metadata = await this.poolMetadata(group.pool);
      if (metadata) usable.push({ group, metadata });
    }
    if (usable.length === 0) return;
    const fromBlock = latestBlock - BigInt(Math.min(9, this.options.initialBlockLookback - 1));
    const addresses = usable.map(({ group }) => group.pool);
    const [v2Logs, v3Logs] = await Promise.all([
      this.options.client.getLogs({ address: addresses, event: v2Swap, fromBlock, toBlock: latestBlock }),
      this.options.client.getLogs({ address: addresses, event: v3Swap, fromBlock, toBlock: latestBlock })
    ]);
    const byPool = new Map(usable.map((entry) => [entry.group.pool.toLowerCase(), entry]));
    const wallets = new Map<string, Address>(); const times = new Map<bigint, Date>();
    for (const log of v2Logs) await this.processV2({ args: log.args, address: log.address, transactionHash: log.transactionHash, blockNumber: log.blockNumber }, byPool, wallets, times);
    for (const log of v3Logs) await this.processV3({ args: log.args, address: log.address, transactionHash: log.transactionHash, blockNumber: log.blockNumber }, byPool, wallets, times);
    await Promise.all(usable.map(({ group }) => this.options.redis.set(`whale-flow:cursor:evm:${this.options.chain}:${group.pool.toLowerCase()}`, latestBlock.toString(), "EX", 86_400)));
  }
  private async processV2(log: V2Log, pools: Map<string, { group: PoolGroup; metadata: PoolMetadata }>, wallets: Map<string, Address>, times: Map<bigint, Date>): Promise<void> {
    const entry = pools.get(log.address.toLowerCase()); if (!entry || !log.transactionHash || !log.blockNumber) return;
    const [wallet, timestamp] = await Promise.all([this.walletFor(log.transactionHash, wallets), this.timestampFor(log.blockNumber, times)]); if (!wallet) return;
    for (const target of entry.group.targets) {
      const decimals = await this.tokenDecimals(target.token); if (decimals === null) continue;
      const isToken0 = entry.metadata.token0.toLowerCase() === target.token.toLowerCase();
      const input = isToken0 ? log.args.amount0In : log.args.amount1In; const output = isToken0 ? log.args.amount0Out : log.args.amount1Out;
      const amount = output && output > 0n ? output : input; if (!amount) continue;
      await this.options.processor.process(this.swap(target, wallet, log.transactionHash, log.blockNumber, timestamp, amount, decimals, output && output > 0n ? "BUY" : "SELL"));
    }
  }
  private async processV3(log: V3Log, pools: Map<string, { group: PoolGroup; metadata: PoolMetadata }>, wallets: Map<string, Address>, times: Map<bigint, Date>): Promise<void> {
    const entry = pools.get(log.address.toLowerCase()); if (!entry || !log.transactionHash || !log.blockNumber) return;
    const [wallet, timestamp] = await Promise.all([this.walletFor(log.transactionHash, wallets), this.timestampFor(log.blockNumber, times)]); if (!wallet) return;
    for (const target of entry.group.targets) {
      const decimals = await this.tokenDecimals(target.token); if (decimals === null) continue;
      const amount = entry.metadata.token0.toLowerCase() === target.token.toLowerCase() ? log.args.amount0 : log.args.amount1;
      if (amount === undefined || amount === 0n) continue;
      await this.options.processor.process(this.swap(target, wallet, log.transactionHash, log.blockNumber, timestamp, amount < 0n ? -amount : amount, decimals, amount < 0n ? "BUY" : "SELL"));
    }
  }
  private swap(target: PoolTarget, wallet: Address, txHash: `0x${string}`, blockNumber: bigint, timestamp: Date, amount: bigint, decimals: number, direction: "BUY" | "SELL"): NormalizedSwap {
    const tokenAmount = Number(formatUnits(amount, decimals));
    return { chain: this.options.chain, txHash, blockNumber: Number(blockNumber), timestamp, wallet, tokenAddress: target.token, tokenSymbol: target.market.symbol, direction, tokenAmount, usdValue: target.market.priceUsd === null ? null : tokenAmount * target.market.priceUsd, quoteTokenAddress: target.market.quoteTokenAddress, quoteTokenSymbol: target.market.quoteTokenSymbol, dexName: "DEX Screener pool", poolAddress: target.market.poolAddress, priceUsd: target.market.priceUsd };
  }
  private async poolMetadata(pool: Address): Promise<PoolMetadata | null> {
    const key = pool.toLowerCase(); if (this.metadata.has(key)) return this.metadata.get(key)!;
    try { const [token0, token1] = await Promise.all([this.options.client.readContract({ address: pool, abi: [token0Abi], functionName: "token0" }), this.options.client.readContract({ address: pool, abi: [token1Abi], functionName: "token1" })]); const value = { token0, token1 }; this.metadata.set(key, value); return value; }
    catch { this.metadata.set(key, null); return null; }
  }
  private async tokenDecimals(token: string): Promise<number | null> {
    const key = token.toLowerCase(); if (this.decimals.has(key)) return this.decimals.get(key)!;
    try { const value = await this.options.client.readContract({ address: token as Address, abi: [decimalsAbi], functionName: "decimals" }); this.decimals.set(key, value); return value; }
    catch { this.decimals.set(key, null); return null; }
  }
  private async walletFor(hash: `0x${string}`, cache: Map<string, Address>): Promise<Address | null> { const cached = cache.get(hash); if (cached) return cached; try { const wallet = (await this.options.client.getTransaction({ hash })).from; cache.set(hash, wallet); return wallet; } catch { return null; } }
  private async timestampFor(block: bigint, cache: Map<bigint, Date>): Promise<Date> { const cached = cache.get(block); if (cached) return cached; const timestamp = new Date(Number((await this.options.client.getBlock({ blockNumber: block })).timestamp) * 1_000); cache.set(block, timestamp); return timestamp; }
}
function chunk<T>(items: T[], size: number): T[][] { return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size)); }
function isRateLimited(error: unknown): boolean { return typeof error === "object" && error !== null && "status" in error && error.status === 429; }
