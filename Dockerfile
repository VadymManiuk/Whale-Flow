FROM node:22-alpine AS build

WORKDIR /app
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY prisma ./prisma
COPY tsconfig.json ./
COPY src ./src
RUN pnpm db:generate && pnpm build

FROM node:22-alpine

WORKDIR /app
RUN corepack enable

COPY --from=build /app/package.json /app/pnpm-lock.yaml ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/dist ./dist

USER node
CMD ["sh", "-c", "pnpm db:deploy && pnpm start:prod"]
