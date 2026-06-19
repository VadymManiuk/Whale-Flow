# Whale Flow Telegram Bot

Alert-only monitoring MVP for repeated whale buying and selling across Ethereum, Base, BNB Chain, and Solana. It never stores private keys, signs transactions, or executes trades.

## What works now

- Strict TypeScript project with Prisma/PostgreSQL and Redis local infrastructure.
- Normalized cross-chain swap model and a tested gradual-flow detector.
- Pattern confirmation: same chain + wallet + token + direction, at least three swaps, 2–30 minute configurable spacing, minimum USD flow, wallet-value threshold, and cooldown.
- Prisma persistence for swaps, wallet snapshots, alerts, tokens, and wallets.
- Telegram notifier and a real Telegram connection test (when credentials are configured).
- Watchlist CLI commands and chain-adapter boundaries for EVM and Solana.
- Live polling for the highest-liquidity V2/V3 pool of each EVM watchlist token when an RPC URL is configured.
- DEX Screener client with response validation, retry, and timeout.

## Setup

```bash
corepack pnpm install
cp .env.example .env
docker compose up -d
pnpm db:migrate
pnpm test
pnpm dev
```

`DATABASE_URL` and `REDIS_URL` are required. Telegram delivery is disabled unless both `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID` are supplied.

## Commands

```bash
pnpm bot token:add --chain base --address 0x... --symbol ESPORTS
pnpm bot wallet:add --chain base --address 0x... --label "ESPORTS seller"
pnpm telegram:test
pnpm health
pnpm bot start
```

`pnpm bot start` runs the service once; `pnpm dev` runs it in watch mode.

For the deployed container, use `docker compose exec -T app pnpm telegram:test:prod` or `docker compose exec -T app pnpm health:prod`.

Add a production token through the running container:

```bash
docker compose exec -T app node dist/cli.js token:add --chain base --address 0x... --symbol TOKEN
```

## Current live-data boundary

EVM polling is active once an EVM RPC URL and a watchlist token are configured. Solana remains a safe skeleton and emits no fabricated swaps. Before full multi-chain live alerts can be sent:

1. Helius enhanced-transaction ingestion and Solana swap normalization.
2. Router, pool, CEX, and MEV filtering beyond using the initiating EOA.
3. Redis-backed detector state (the MVP detector uses in-memory state and resets on restart) and the optional dip-buyer PnL detector.

## Verification

```bash
pnpm lint
pnpm test
pnpm build
```
