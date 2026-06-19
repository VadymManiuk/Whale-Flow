CREATE TABLE "DexPool" (
  "id" TEXT NOT NULL, "chain" "Chain" NOT NULL, "poolAddress" TEXT NOT NULL,
  "tokenAddress" TEXT NOT NULL, "tokenSymbol" TEXT, "quoteTokenAddress" TEXT,
  "quoteTokenSymbol" TEXT, "priceUsd" DOUBLE PRECISION, "liquidityUsd" DOUBLE PRECISION,
  "chartUrl" TEXT, "enabled" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DexPool_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "DexPool_chain_poolAddress_tokenAddress_key" ON "DexPool"("chain", "poolAddress", "tokenAddress");
CREATE INDEX "DexPool_chain_enabled_idx" ON "DexPool"("chain", "enabled");
