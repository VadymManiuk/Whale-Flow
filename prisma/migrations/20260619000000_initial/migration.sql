CREATE TYPE "Chain" AS ENUM ('ethereum', 'base', 'bnb', 'solana');
CREATE TYPE "SwapDirection" AS ENUM ('BUY', 'SELL');
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

CREATE TABLE "Swap" (
  "id" TEXT NOT NULL, "chain" "Chain" NOT NULL, "txHash" TEXT NOT NULL,
  "blockNumber" BIGINT, "slot" BIGINT, "timestamp" TIMESTAMP(3) NOT NULL,
  "wallet" TEXT NOT NULL, "tokenAddress" TEXT NOT NULL, "tokenSymbol" TEXT,
  "direction" "SwapDirection" NOT NULL, "tokenAmount" DOUBLE PRECISION NOT NULL,
  "usdValue" DOUBLE PRECISION, "quoteTokenAddress" TEXT, "quoteTokenSymbol" TEXT,
  "dexName" TEXT, "poolAddress" TEXT, "priceUsd" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Swap_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Swap_chain_txHash_wallet_tokenAddress_direction_key" ON "Swap"("chain", "txHash", "wallet", "tokenAddress", "direction");
CREATE INDEX "Swap_chain_wallet_tokenAddress_direction_timestamp_idx" ON "Swap"("chain", "wallet", "tokenAddress", "direction", "timestamp");

CREATE TABLE "WalletSnapshot" (
  "id" TEXT NOT NULL, "chain" "Chain" NOT NULL, "wallet" TEXT NOT NULL,
  "tokenAddress" TEXT, "tokenSymbol" TEXT, "tokenBalanceUsd" DOUBLE PRECISION,
  "stableAndNativeBalanceUsd" DOUBLE PRECISION, "rawJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WalletSnapshot_chain_wallet_tokenAddress_createdAt_idx" ON "WalletSnapshot"("chain", "wallet", "tokenAddress", "createdAt");

CREATE TABLE "Alert" (
  "id" TEXT NOT NULL, "type" TEXT NOT NULL, "chain" "Chain" NOT NULL,
  "wallet" TEXT NOT NULL, "tokenAddress" TEXT NOT NULL, "tokenSymbol" TEXT,
  "direction" "SwapDirection" NOT NULL, "severity" "Severity" NOT NULL,
  "swapsCount" INTEGER NOT NULL, "totalUsdValue" DOUBLE PRECISION NOT NULL,
  "avgIntervalMinutes" DOUBLE PRECISION NOT NULL, "firstSwapAt" TIMESTAMP(3) NOT NULL,
  "lastSwapAt" TIMESTAMP(3) NOT NULL, "message" TEXT NOT NULL,
  "telegramMessageId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Alert_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Alert_chain_wallet_tokenAddress_direction_createdAt_idx" ON "Alert"("chain", "wallet", "tokenAddress", "direction", "createdAt");

CREATE TABLE "WatchlistToken" (
  "id" TEXT NOT NULL, "chain" "Chain" NOT NULL, "tokenAddress" TEXT NOT NULL,
  "symbol" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "minWalletTokenValueUsd" DOUBLE PRECISION, "minWalletStableOrNativeValueUsd" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WatchlistToken_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WatchlistToken_chain_tokenAddress_key" ON "WatchlistToken"("chain", "tokenAddress");

CREATE TABLE "WatchlistWallet" (
  "id" TEXT NOT NULL, "chain" "Chain" NOT NULL, "wallet" TEXT NOT NULL,
  "label" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WatchlistWallet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WatchlistWallet_chain_wallet_key" ON "WatchlistWallet"("chain", "wallet");
