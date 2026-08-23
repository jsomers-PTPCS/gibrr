# Gibrr

A federated social platform: a Reddit/Lemmy-style feed combined with a
Facebook/Friendica-style profile, built on [ActivityPub](https://www.w3.org/TR/activitypub/)
so it federates with Mastodon, Lemmy, Friendica, and the rest of the fediverse.

Auth, posts/comments/votes, communities/groups, follows and friends,
direct messages, photos/albums, calendar sync, a full admin panel,
search, and a trending/explore feature for browsing other
Mastodon-API-compatible servers are all built — see [DEPLOY.md](DEPLOY.md)
to run your own instance.

## Stack

- **API** (`apps/api`): Node.js/TypeScript, Express, Postgres via Prisma.
  Hand-rolled ActivityPub layer (WebFinger, Actor, HTTP Signatures) rather
  than a Mongo-oriented library, so federation identity data lives in the
  same Postgres database as everything else.
- **Web** (`apps/web`): Next.js (TypeScript).
- Package manager: pnpm workspaces.

## Prerequisites

- Node.js 20+ (see `.nvmrc`)
- pnpm (`corepack enable && corepack prepare pnpm@9 --activate` if you don't
  have it — pnpm's latest major currently requires Node 22+, so pin to v9 on
  Node 20)
- Docker (for local Postgres)

## Setup

```bash
docker compose up -d                 # starts Postgres on :5432
pnpm install

cp apps/api/.env.example apps/api/.env
cp apps/web/.env.local.example apps/web/.env.local

pnpm --filter @gibrr/api prisma:generate
pnpm --filter @gibrr/api prisma:migrate --name init
pnpm --filter @gibrr/api seed         # creates a local actor: testuser
```

## Run

```bash
pnpm --filter @gibrr/api dev          # API on http://localhost:4000
pnpm --filter @gibrr/web dev          # Web on http://localhost:3000
```

Or run both at once from the root: `pnpm dev`.

## Verify the federation skeleton

With the API running and seeded:

```bash
curl http://localhost:4000/health
# {"status":"ok"}

curl "http://localhost:4000/.well-known/webfinger?resource=acct:testuser@localhost:4000"
# JRD with a link to http://localhost:4000/users/testuser

curl -H "Accept: application/activity+json" http://localhost:4000/users/testuser
# ActivityPub Actor JSON-LD, including a publicKey block
```

Visit `http://localhost:3000` — the landing page fetches `/health` from the
API live to confirm the two apps are connected.

Note: full external federation (e.g. following `testuser@localhost` from a
real Mastodon instance) isn't testable without a public domain and TLS —
that's the natural next milestone once real feed/profile features exist.

## Deploying your own instance

See [DEPLOY.md](DEPLOY.md) — a one-command Docker installer
(`./install.sh`) builds the app, stands up Postgres, and fronts
everything with Caddy for automatic HTTPS. That's what people
downloading this repo to self-host should use, not the dev instructions
above (those run everything unbuilt, without TLS, for working on the
code itself).

