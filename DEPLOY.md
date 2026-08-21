# Deploying Gibrr

The fastest way to run your own instance is the Docker installer. It
builds the API and web app, stands up Postgres, and fronts everything
with [Caddy](https://caddyserver.com/) for automatic HTTPS.

## Requirements

- A server (VPS or otherwise) with **Docker** and the **Compose plugin**
  installed. See <https://docs.docker.com/engine/install/> if you need
  either.
- A domain name, with DNS already pointed at this server's public IP
  address, **before** you run the installer — Caddy needs that to be
  able to issue a real TLS certificate on first request. Real ActivityPub
  federation requires HTTPS; there's no way around that.
- You'll actually want *two* domains/subdomains: one for the site itself,
  one for its ActivityPub/API traffic. The second one is what your
  fediverse handle uses (`@you@that-domain`). `api.yoursite.com` alongside
  `yoursite.com` is the easy default — the installer suggests exactly
  that if you leave it blank.

## Install

```bash
git clone <this-repo-url> gibrr
cd gibrr
./install.sh
```

It'll ask for:
- the site's domain
- the API/federation domain (defaults to `api.<site domain>`)
- outgoing SMTP settings, optional — skip it and verification/reset
  emails just get logged instead of sent, which is fine to kick the
  tires but not fine for real users who lock themselves out

Then it builds the images and brings the stack up. First build takes a
few minutes. Once it's done, visit `https://<your site domain>/setup` to
create the first (admin) account — a fresh instance has no users, and
that page is only reachable until the first one exists.

## What the installer actually does

Everything lives in `docker-compose.prod.yml`, run under its own Compose
project name (`gibrr`) and its own env file (`.env.prod`) — both
deliberately separate from `docker-compose.yml`/`.env` at this same repo
path, which are this repo's *own* local dev Postgres container, not
anything an end-user install should ever touch. If you ever run compose
commands by hand instead of through `install.sh`, use:

```bash
docker compose -p gibrr -f docker-compose.prod.yml --env-file .env.prod <command>
```

Four containers:
- **postgres** — the database. Data lives in a named Docker volume
  (`gibrr_gibrr_postgres_data`), survives container recreation/upgrades.
- **api** — the Express/Prisma backend. Runs `prisma migrate deploy` on
  every start (a no-op once the schema's current), then starts the
  server. Uploaded images/avatars live in another named volume
  (`gibrr_gibrr_uploads_data`).
- **web** — the Next.js frontend.
- **caddy** — reverse proxy + automatic TLS. The only container with
  ports published to the host (80/443); everything else is only
  reachable over the compose-internal network.

## Updating

```bash
git pull
docker compose -p gibrr -f docker-compose.prod.yml --env-file .env.prod up -d --build
```

Migrations run automatically on the API container's next start.

## Backing up

Back up the `gibrr_gibrr_postgres_data` and `gibrr_gibrr_uploads_data`
Docker volumes — that's the entire state of the instance (everything
else is rebuildable from the Git repo + `.env.prod`).

```bash
docker run --rm -v gibrr_gibrr_postgres_data:/data -v "$PWD":/backup \
  alpine tar czf /backup/postgres-backup.tar.gz -C /data .
```

## Testing locally without a real domain/TLS

You don't need Caddy or a public domain just to try the app out. From
the repo root, with a `.env.prod` of your choosing:

```bash
docker compose -p gibrr -f docker-compose.prod.yml --env-file .env.prod \
  up -d --build postgres api web
```

Then reach the containers directly with a temporary port-publish
override (don't commit this) rather than through Caddy:

```yaml
# docker-compose.local-test.yml
services:
  api:
    ports: ["14000:4000"]
  web:
    ports: ["13000:3000"]
```

```bash
docker compose -p gibrr -f docker-compose.prod.yml -f docker-compose.local-test.yml \
  --env-file .env.prod up -d --build postgres api web
```

`http://localhost:13000` is then the site, `http://localhost:14000` the
API. Set `WEB_DOMAIN=localhost` and `API_DOMAIN=localhost` in
`.env.prod` for this mode — federation with real remote servers won't
work over plain HTTP, but everything else (auth, posts, the whole
front end) works fine for trying it out.

## Manual (non-Docker) deploy

If you'd rather run it directly on a host instead of in containers —
Node 20+, a Postgres instance, and:

```bash
pnpm install
cd apps/api
pnpm prisma:generate
npx prisma migrate deploy
pnpm build && NODE_ENV=production node dist/index.js
```

```bash
cd apps/web
NEXT_PUBLIC_API_URL=https://api.yoursite.com pnpm build && pnpm start
```

`apps/api/.env` needs `DATABASE_URL`, `PORT`, `DOMAIN` (the public API
domain, no scheme), `WEB_ORIGIN` (`https://` + the site domain), and
`NODE_ENV=production`. Front both processes with your own reverse proxy
(nginx, Caddy, whatever) for TLS — same domain-split reasoning as the
Docker path above.
