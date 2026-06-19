import type { WhaleAlert } from "../../models/alert.js";

function usd(value: number | null): string { return value === null ? "unavailable" : `$${Math.round(value).toLocaleString("en-US")}`; }
function shortWallet(wallet: string): string { return wallet.length <= 12 ? wallet : `${wallet.slice(0, 6)}…${wallet.slice(-4)}`; }
function explorer(chain: WhaleAlert["chain"], wallet: string, transactionHash: string): { wallet: string; tx: string } {
  const base = chain === "ethereum" ? "https://etherscan.io" : chain === "base" ? "https://basescan.org" : chain === "bnb" ? "https://bscscan.com" : "https://solscan.io";
  const transactionPath = chain === "solana" ? "tx" : "tx";
  return { wallet: `${base}/address/${wallet}`, tx: `${base}/${transactionPath}/${transactionHash}` };
}

export function formatWhaleAlert(alert: WhaleAlert): string {
  const links = explorer(alert.chain, alert.wallet, alert.transactionHash);
  const label = alert.direction === "SELL" ? "🔴 Gradual Whale Seller Detected" : "🟢 Gradual Whale Buyer Detected";
  const remaining = alert.direction === "SELL" ? `Remaining token value: ${usd(alert.remainingTokenBalanceUsd)}` : `Stable/native buying power: ${usd(alert.remainingStableAndNativeBalanceUsd)}`;
  const chart = alert.chartUrl ? `\nChart: ${alert.chartUrl}` : "";
  return `${label}\n\nToken: ${alert.tokenSymbol ?? alert.tokenAddress}\nChain: ${alert.chain}\nWallet: ${shortWallet(alert.wallet)}\nDirection: ${alert.direction}\nSeverity: ${alert.severity} (${alert.confidence} confidence)\n\nPattern:\n• ${alert.swapsCount} swaps detected\n• Total flow: ${usd(alert.totalUsdValue)}\n• Avg interval: ${alert.averageIntervalMinutes.toFixed(1)} min\n• First: ${alert.firstSwapAt.toISOString().slice(11, 16)} UTC\n• Last: ${alert.lastSwapAt.toISOString().slice(11, 16)} UTC\n\nWallet:\n• ${remaining}\n\nLinks:\nWallet: ${links.wallet}\nLast tx: ${links.tx}${chart}`;
}
