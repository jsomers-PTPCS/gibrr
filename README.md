# Gibrr

A federated social platform: a Reddit/Lemmy-style feed combined with a
Facebook/Friendica-style profile, built on [ActivityPub](https://www.w3.org/TR/activitypub/)
so it federates with Mastodon, Lemmy, Friendica, and the rest of the fediverse.

This is an early scaffold: a working federation skeleton (WebFinger, Actor
profile, signed inbox handling a `Follow` activity) plus a placeholder web
frontend. Posts, comments, votes, communities, and outbox delivery are not
built yet — see "Status" below.

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

pnpm --filter @astrion/api prisma:generate
pnpm --filter @astrion/api prisma:migrate --name init
pnpm --filter @astrion/api seed         # creates a local actor: testuser
```

## Run

```bash
pnpm --filter @astrion/api dev          # API on http://localhost:4000
pnpm --filter @astrion/web dev          # Web on http://localhost:3000
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

## Status / what's not built yet

- Auth / login
- Posts, comments, votes, communities (the actual feed + profile features)
- Outbox activity delivery to remote servers, and a real job queue
- Following *from* Gibrr (currently only handles inbound `Follow`)
- Broader ActivityPub activity coverage (`Create`, `Like`, `Announce`, `Undo`, …)
