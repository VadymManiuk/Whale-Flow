import { formatUnits, isAddress, parseAbiItem, type Address, type PublicClient } from "viem";
import type { Redis } from "ioredis";
import type { DexPoolRepository } from "../db/repositories.js";
import type { ChainId } from "../models/chain.js";
import type { NormalizedSwap } from "../models/swap.js";
import type { TokenMarketData } from "../integrations/price/dexscreener-client.js";
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
  chain: Extract<ChainId, "ethereum" | "base" | "bnb">; client: PublicClient; pools: DexPoolRepository;
  processor: SwapProcessingService; redis: Redis; logger: Logger; intervalSeconds: number; initialBlockLookback: number; minLiquidityUsd: number; batchSize: number; batchesPerCycle: number;
}

/** Batches pool addresses per event signature to stay within free-RPC limits. */
export class EvmWatchlistPoller {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  private cooldownUntil = 0;
  private batchCursor = 0;
  private effectiveBatchSize: number;
  private successfulPolls = 0;
  private readonly metadata = new Map<string, PoolMetadata | null>();
  private readonly decimals = new Map<string, number | null>();
  public constructor(private readonly options: EvmPollerOptions) {
    this.effectiveBatchSize = options.batchSize;
  }
  public start(): void { if (!this.timer) { void this.poll(); this.timer = setInterval(() => void this.poll(), this.options.intervalSeconds * 1_000); } }
  public stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async poll(): Promise<void> {
    if (this.running || Date.now() < this.cooldownUntil) return;
    this.running = true;
    try {
      const [targets, latestBlock] = await Promise.all([this.options.pools.listEnabled(this.options.chain), this.options.client.getBlockNumber()]);
      const groups = this.groupsFor(targets);
      const batches = chunk(groups, this.effectiveBatchSize);
      for (let index = 0; index < Math.min(this.options.batchesPerCycle, batches.length); index += 1) {
        const batch = batches[this.batchCursor % batches.length];
        this.batchCursor += 1;
        await this.pollBatch(batch, latestBlock);
      }
      this.recordSuccessfulPoll();
    } catch (error) {
      if (isRateLimited(error)) this.reduceBatchAfterRateLimit();
      else this.options.logger.error({ err: error, chain: this.options.chain }, "EVM watchlist polling failed");
    } finally { this.running = false; }
  }
  private groupsFor(targets: Array<{ tokenAddress: string; market: TokenMarketData }>): PoolGroup[] {
    const groups = new Map<string, PoolGroup>();
    for (const { tokenAddress: token, market } of targets) {
      if (!isAddress(token) || !isAddress(market.poolAddress) || (market.liquidityUsd ?? 0) < this.options.minLiquidityUsd) continue;
      const key = market.poolAddress.toLowerCase();
      const group = groups.get(key) ?? { pool: market.poolAddress as Address, targets: [] };
      group.targets.push({ token, market }); groups.set(key, group);
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
    const addresses = usable.map(({ group }) => group.pool);
    const cursorKeys = addresses.map((pool) => this.cursorKey(pool));
    const cursorValues = await this.options.redis.mget(...cursorKeys);
    const cursors = cursorValues.flatMap((value) => {
      if (value === null || !/^\d+$/.test(value)) return [];
      return [BigInt(value)];
    });
    const initialFromBlock = latestBlock - BigInt(this.options.initialBlockLookback - 1);
    // Every pool in a batch is queried from its oldest cursor. This keeps the
    // round-robin scan complete even when a full catalog takes longer than the
    // initial lookback window to visit once.
    const fromBlock = cursors.length === 0
      ? initialFromBlock
      : cursors.reduce((oldest, cursor) => cursor < oldest ? cursor : oldest) + 1n;
    if (fromBlock > latestBlock) return;
    // Alchemy Free accepts at most ten blocks per eth_getLogs request. Advance
    // the cursor in bounded chunks so a slow round-robin scan catches up over
    // subsequent polls instead of issuing an invalid oversized request.
    const toBlock = minBlock(latestBlock, fromBlock + BigInt(this.options.initialBlockLookback - 1));
    const [v2Logs, v3Logs] = await Promise.all([
      this.options.client.getLogs({ address: addresses, event: v2Swap, fromBlock, toBlock }),
      this.options.client.getLogs({ address: addresses, event: v3Swap, fromBlock, toBlock })
    ]);
    const byPool = new Map(usable.map((entry) => [entry.group.pool.toLowerCase(), entry]));
    const wallets = new Map<string, Address>(); const times = new Map<bigint, Date>();
    for (const log of v2Logs) await this.processV2({ args: log.args, address: log.address, transactionHash: log.transactionHash, blockNumber: log.blockNumber }, byPool, wallets, times);
    for (const log of v3Logs) await this.processV3({ args: log.args, address: log.address, transactionHash: log.transactionHash, blockNumber: log.blockNumber }, byPool, wallets, times);
    await Promise.all(addresses.map((pool) => this.options.redis.set(this.cursorKey(pool), toBlock.toString(), "EX", 86_400)));
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
  private cursorKey(pool: Address): string { return `whale-flow:cursor:evm:${this.options.chain}:${pool.toLowerCase()}`; }
  private reduceBatchAfterRateLimit(): void {
    const previousBatchSize = this.effectiveBatchSize;
    this.effectiveBatchSize = Math.max(10, Math.floor(previousBatchSize / 2));
    this.successfulPolls = 0;
    this.cooldownUntil = Date.now() + 60_000;
    this.options.logger.warn({ chain: this.options.chain, cooldownSeconds: 60, previousBatchSize, nextBatchSize: this.effectiveBatchSize }, "EVM RPC rate limited; scanner paused and batch reduced");
  }
  private recordSuccessfulPoll(): void {
    this.successfulPolls += 1;
    if (this.successfulPolls < 12 || this.effectiveBatchSize >= this.options.batchSize) return;
    const previousBatchSize = this.effectiveBatchSize;
    this.effectiveBatchSize = Math.min(this.options.batchSize, this.effectiveBatchSize + 10);
    this.successfulPolls = 0;
    this.options.logger.info({ chain: this.options.chain, previousBatchSize, nextBatchSize: this.effectiveBatchSize }, "EVM scanner batch increased after stable polling");
  }
}
function chunk<T>(items: T[], size: number): T[][] { return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size)); }
function minBlock(left: bigint, right: bigint): bigint { return left < right ? left : right; }
function isRateLimited(error: unknown): boolean { return typeof error === "object" && error !== null && "status" in error && error.status === 429; }
