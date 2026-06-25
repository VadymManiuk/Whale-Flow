import { createPublicClient, http, type PublicClient } from "viem";
import type { ChainId } from "../../models/chain.js";
import type { Logger } from "../../utils/logger.js";

interface RpcProviderState {
  readonly id: string;
  readonly client: PublicClient;
  cooldownUntil: number;
}

const PROVIDER_COOLDOWN_MS = 60 * 60 * 1_000;

/**
 * Creates a viem-compatible PublicClient that rotates across RPC URLs.
 *
 * We intentionally keep this as a thin Proxy around viem clients so the rest of
 * the code can keep using normal methods like getLogs/readContract. Provider
 * failures such as 429, monthly quota exhaustion, and timeouts temporarily
 * disable only that URL instead of stopping the whole scanner.
 */
export function createResilientPublicClient(
  chain: Extract<ChainId, "ethereum" | "base" | "bnb">,
  rpcUrls: readonly string[],
  logger: Logger
): PublicClient | undefined {
  const providers: RpcProviderState[] = uniqueUrls(rpcUrls).map((url, index) => ({
    id: providerId(url, index),
    client: createPublicClient({ transport: http(url) }),
    cooldownUntil: 0
  }));

  if (providers.length === 0) return undefined;

  let currentIndex = 0;

  const callWithRotation = async (method: keyof PublicClient, args: unknown[]): Promise<unknown> => {
    let lastError: unknown;

    for (let attempt = 0; attempt < providers.length; attempt += 1) {
      const provider = nextAvailableProvider(providers, currentIndex + attempt);
      if (!provider) break;

      try {
        const fn = provider.client[method];
        if (typeof fn !== "function") return fn;
        const result = await (fn as (...innerArgs: unknown[]) => unknown).apply(provider.client, args);
        currentIndex = providers.indexOf(provider);
        return result;
      } catch (error) {
        lastError = error;
        if (!isRpcProviderFailure(error)) throw error;

        provider.cooldownUntil = Date.now() + PROVIDER_COOLDOWN_MS;
        logger.warn(
          { chain, rpcProvider: provider.id, cooldownSeconds: PROVIDER_COOLDOWN_MS / 1_000, reason: rpcFailureReason(error) },
          "EVM RPC provider temporarily disabled"
        );
      }
    }

    throw lastError instanceof Error ? lastError : new Error(`No available RPC providers for ${chain}`);
  };

  return new Proxy(providers[0]!.client, {
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => callWithRotation(property as keyof PublicClient, args);
    }
  }) as PublicClient;
}

export function mergeRpcUrls(primaryUrls: string | undefined, legacyUrl: string | undefined): string[] {
  const urls = parseRpcUrls(primaryUrls);
  if (legacyUrl) urls.push(legacyUrl);
  return uniqueUrls(urls);
}

function parseRpcUrls(value: string | undefined): string[] {
  if (!value) return [];
  return value.split(",").map((url) => url.trim()).filter(Boolean);
}

function uniqueUrls(urls: readonly string[]): string[] {
  return [...new Set(urls)];
}

function nextAvailableProvider(providers: RpcProviderState[], startIndex: number): RpcProviderState | undefined {
  const now = Date.now();
  for (let offset = 0; offset < providers.length; offset += 1) {
    const provider = providers[(startIndex + offset) % providers.length]!;
    if (provider.cooldownUntil <= now) return provider;
  }
  return undefined;
}

function providerId(url: string, index: number): string {
  try {
    return `${new URL(url).hostname}#${index + 1}`;
  } catch {
    return `rpc#${index + 1}`;
  }
}

function isRpcProviderFailure(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "status" in error && error.status === 429) return true;
  if (!(error instanceof Error)) return false;
  return /429|rate limit|too many requests|monthly capacity limit exceeded|capacity limit exceeded|request timed out|took too long to respond|timeout|fetch failed|network error/i.test(error.message);
}

function rpcFailureReason(error: unknown): string {
  if (!(error instanceof Error)) return "unknown";
  if (/monthly capacity limit exceeded|capacity limit exceeded/i.test(error.message)) return "capacity_limit";
  if (/429|rate limit|too many requests/i.test(error.message)) return "rate_limit";
  if (/request timed out|took too long to respond|timeout/i.test(error.message)) return "timeout";
  if (/fetch failed|network error/i.test(error.message)) return "network";
  return "rpc_failure";
}
