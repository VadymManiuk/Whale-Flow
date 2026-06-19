import { isAddress, parseAbiItem, formatUnits, type Address, type PublicClient } from "viem";
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

interface BaseLog { transactionHash?: `0x${string}`; blockNumber?: bigint; }
interface V2Log extends BaseLog { args: { amount0In?: bigint; amount1In?: bigint; amount0Out?: bigint; amount1Out?: bigint; }; }
interface V3Log extends BaseLog { args: { amount0?: bigint; amount1?: bigint; }; }

export interface EvmPollerOptions {
  chain: Extract<ChainId, "ethereum" | "base" | "bnb">;
  client: PublicClient;
  watchlists: WatchlistRepository;
  prices: DexScreenerClient;
  processor: SwapProcessingService;
  redis: Redis;
  logger: Logger;
  intervalSeconds: number;
  initialBlockLookback: number;
  minLiquidityUsd: number;
}

/** Polls the most liquid DEX Screener pool for every enabled watchlist token. */
export class EvmWatchlistPoller {
  private timer: NodeJS.Timeout | undefined;
  private running = false;
  public constructor(private readonly options: EvmPollerOptions) {}

  public start(): void {
    if (this.timer) return;
    void this.poll();
    this.timer = setInterval(() => void this.poll(), this.options.intervalSeconds * 1_000);
  }
  public stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async poll(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const tokens = await this.options.watchlists.listEnabledTokens(this.options.chain);
      for (const token of tokens) await this.pollToken(token.address);
    } catch (error) {
      this.options.logger.error({ err: error, chain: this.options.chain }, "EVM watchlist polling failed");
    } finally {
      this.running = false;
    }
  }

  private async pollToken(tokenAddress: string): Promise<void> {
    const market = await this.options.prices.getTokenMarketData(this.options.chain, tokenAddress);
    if (!market || !isAddress(tokenAddress) || !isAddress(market.poolAddress) || (market.liquidityUsd ?? 0) < this.options.minLiquidityUsd) return;
    const latestBlock = await this.options.client.getBlockNumber();
    const cursorKey = `whale-flow:cursor:evm:${this.options.chain}:${market.poolAddress.toLowerCase()}`;
    const previous = await this.options.redis.get(cursorKey);
    const requestedStart = previous ? BigInt(previous) + 1n : latestBlock - BigInt(this.options.initialBlockLookback - 1);
    // Alchemy Free limits eth_getLogs to ten blocks. A live monitor prioritizes
    // current events after a long outage rather than failing every poll forever.
    const fromBlock = requestedStart < latestBlock - 9n ? latestBlock - 9n : requestedStart;
    if (fromBlock > latestBlock) return;
    const pool = market.poolAddress as Address;
    const [token0, token1, decimals] = await Promise.all([
      this.options.client.readContract({ address: pool, abi: [token0Abi], functionName: "token0" }),
      this.options.client.readContract({ address: pool, abi: [token1Abi], functionName: "token1" }),
      this.options.client.readContract({ address: tokenAddress as Address, abi: [decimalsAbi], functionName: "decimals" })
    ]);
    const trackedIsToken0 = token0.toLowerCase() === tokenAddress.toLowerCase();
    if (!trackedIsToken0 && token1.toLowerCase() !== tokenAddress.toLowerCase()) return;
    const [v2Logs, v3Logs] = await Promise.all([
      this.options.client.getLogs({ address: pool, event: v2Swap, fromBlock, toBlock: latestBlock }),
      this.options.client.getLogs({ address: pool, event: v3Swap, fromBlock, toBlock: latestBlock })
    ]);
    const transactionWallets = new Map<string, Address>();
    const blockTimes = new Map<bigint, Date>();
    for (const log of v2Logs) {
      if (!log.transactionHash || !log.blockNumber) continue;
      const wallet = await this.walletFor(log.transactionHash, transactionWallets);
      if (!wallet) continue;
      const timestamp = await this.timestampFor(log.blockNumber, blockTimes);
      const swap = this.fromV2({ args: log.args, transactionHash: log.transactionHash, blockNumber: log.blockNumber }, tokenAddress, market, trackedIsToken0, decimals, wallet, timestamp);
      if (swap) await this.options.processor.process(swap);
    }
    for (const log of v3Logs) {
      if (!log.transactionHash || !log.blockNumber) continue;
      const wallet = await this.walletFor(log.transactionHash, transactionWallets);
      if (!wallet) continue;
      const timestamp = await this.timestampFor(log.blockNumber, blockTimes);
      const swap = this.fromV3({ args: log.args, transactionHash: log.transactionHash, blockNumber: log.blockNumber }, tokenAddress, market, trackedIsToken0, decimals, wallet, timestamp);
      if (swap) await this.options.processor.process(swap);
    }
    await this.options.redis.set(cursorKey, latestBlock.toString(), "EX", 86_400);
  }

  private async walletFor(hash: `0x${string}`, cache: Map<string, Address>): Promise<Address | null> {
    const existing = cache.get(hash);
    if (existing) return existing;
    try {
      const wallet = (await this.options.client.getTransaction({ hash })).from;
      cache.set(hash, wallet);
      return wallet;
    } catch (error) {
      this.options.logger.warn({ err: error, hash }, "Unable to resolve EVM transaction initiator");
      return null;
    }
  }
  private async timestampFor(blockNumber: bigint, cache: Map<bigint, Date>): Promise<Date> {
    const existing = cache.get(blockNumber);
    if (existing) return existing;
    const timestamp = new Date(Number((await this.options.client.getBlock({ blockNumber })).timestamp) * 1_000);
    cache.set(blockNumber, timestamp);
    return timestamp;
  }
  private fromV2(log: V2Log, token: string, market: TokenMarketData, isToken0: boolean, decimals: number, wallet: Address, timestamp: Date): NormalizedSwap | null {
    const input = isToken0 ? log.args.amount0In : log.args.amount1In;
    const output = isToken0 ? log.args.amount0Out : log.args.amount1Out;
    const rawAmount = output && output > 0n ? output : input;
    if (!rawAmount || !log.transactionHash) return null;
    return this.swap({ token, market, wallet, txHash: log.transactionHash, blockNumber: log.blockNumber, timestamp, amount: rawAmount, decimals, direction: output && output > 0n ? "BUY" : "SELL" });
  }
  private fromV3(log: V3Log, token: string, market: TokenMarketData, isToken0: boolean, decimals: number, wallet: Address, timestamp: Date): NormalizedSwap | null {
    const amount = isToken0 ? log.args.amount0 : log.args.amount1;
    if (amount === undefined || amount === 0n || !log.transactionHash) return null;
    // A positive V3 amount means the pool received tracked token (wallet sold).
    return this.swap({ token, market, wallet, txHash: log.transactionHash, blockNumber: log.blockNumber, timestamp, amount: amount < 0n ? -amount : amount, decimals, direction: amount < 0n ? "BUY" : "SELL" });
  }
  private swap(input: { token: string; market: TokenMarketData; wallet: Address; txHash: `0x${string}`; blockNumber?: bigint; timestamp: Date; amount: bigint; decimals: number; direction: "BUY" | "SELL" }): NormalizedSwap {
    const tokenAmount = Number(formatUnits(input.amount, input.decimals));
    return {
      chain: this.options.chain,
      txHash: input.txHash,
      blockNumber: input.blockNumber ? Number(input.blockNumber) : undefined,
      timestamp: input.timestamp,
      wallet: input.wallet,
      tokenAddress: input.token,
      tokenSymbol: input.market.symbol,
      direction: input.direction,
      tokenAmount,
      usdValue: input.market.priceUsd === null ? null : tokenAmount * input.market.priceUsd,
      quoteTokenAddress: input.market.quoteTokenAddress,
      quoteTokenSymbol: input.market.quoteTokenSymbol,
      dexName: "DEX Screener pool",
      poolAddress: input.market.poolAddress,
      priceUsd: input.market.priceUsd
    };
  }
}
