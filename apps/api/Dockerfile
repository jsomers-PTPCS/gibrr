# Built with the repo root as build context (this is a pnpm workspace —
# the api package alone can't resolve pnpm-workspace.yaml/tsconfig.base.json
# without it). See docker-compose.yml's `build.context: .`.

FROM node:20-bookworm-slim AS base
# Debian (glibc), not alpine — sharp and Prisma's query engine both ship
# prebuilt binaries for glibc; alpine (musl) needs extra config for both.
# openssl is Prisma's own runtime dependency for its query engine.
RUN apt-get update && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@9.15.9 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/api apps/api
RUN pnpm --filter @gibrr/api prisma:generate
RUN pnpm --filter @gibrr/api build

FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/prisma ./apps/api/prisma
COPY --from=build /app/apps/api/package.json ./apps/api/package.json
WORKDIR /app/apps/api

EXPOSE 4000
# migrate deploy is safe to run on every start (a no-op once the schema is
# current) — keeps a fresh install and a restart of an existing one on the
# same code path, no separate "first run" step to remember.
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
