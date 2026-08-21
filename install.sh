#!/usr/bin/env bash
# All-in-one installer: prompts for your domain(s), generates the .env.prod
# docker-compose.prod.yml reads, builds the images, and brings the stack up
# (Postgres + the API + the web app + Caddy for automatic HTTPS).
#
# Deliberately uses its own compose project name (-p gibrr) and its own
# env file (.env.prod), entirely separate from docker-compose.yml/.env at
# this same path — those belong to this repo's own local dev Postgres
# container and must never be touched by an end-user's install.
#
# Requires: a server with Docker + the Compose plugin, and DNS for your
# domain(s) already pointing at this machine (Caddy needs that to issue a
# real TLS certificate — see README.md if you want to test locally
# without real DNS/TLS first).
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")"

COMPOSE="docker compose -p gibrr -f docker-compose.prod.yml --env-file .env.prod"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker isn't installed. Install it first: https://docs.docker.com/engine/install/" >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "The Docker Compose plugin isn't installed (docker compose). Install it first: https://docs.docker.com/compose/install/" >&2
  exit 1
fi

if [ -f .env.prod ]; then
  echo "A .env.prod already exists here — this looks like an existing install."
  read -r -p "Reconfigure anyway and overwrite it? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Leaving .env.prod alone. Run '$COMPOSE up -d --build' to (re)start with it."
    exit 0
  fi
fi

echo "== Gibrr installer =="
echo
echo "Gibrr runs as two public web addresses: one for the site itself, one"
echo "for its ActivityPub/API traffic (this is what your fediverse handle"
echo "@you@<that domain> will use). Both need DNS already pointed at this"
echo "server's IP address."
echo
read -r -p "Domain for the site (e.g. gibrr.example.com): " WEB_DOMAIN
if [ -z "$WEB_DOMAIN" ]; then
  echo "A domain is required." >&2
  exit 1
fi
read -r -p "Domain for the API/federation [api.$WEB_DOMAIN]: " API_DOMAIN
API_DOMAIN="${API_DOMAIN:-api.$WEB_DOMAIN}"

echo
echo "Outgoing email (verification links, password resets) — optional."
echo "Leave blank to skip: emails will just be logged instead of sent,"
echo "fine to try the app, not fine for real users to reset a password."
read -r -p "SMTP host (blank to skip): " SMTP_HOST
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="no-reply@$WEB_DOMAIN"
if [ -n "$SMTP_HOST" ]; then
  read -r -p "SMTP port [587]: " input; SMTP_PORT="${input:-587}"
  read -r -p "SMTP username: " SMTP_USER
  read -r -s -p "SMTP password: " SMTP_PASS; echo
  read -r -p "\"From\" address [no-reply@$WEB_DOMAIN]: " input; SMTP_FROM="${input:-$SMTP_FROM}"
fi

POSTGRES_PASSWORD="$(openssl rand -hex 24 2>/dev/null || head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32)"

cat > .env.prod <<EOF
WEB_DOMAIN=$WEB_DOMAIN
API_DOMAIN=$API_DOMAIN
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
SMTP_HOST=$SMTP_HOST
SMTP_PORT=$SMTP_PORT
SMTP_SECURE=$SMTP_SECURE
SMTP_USER=$SMTP_USER
SMTP_PASS=$SMTP_PASS
SMTP_FROM=$SMTP_FROM
EOF
chmod 600 .env.prod

echo
echo "Wrote .env.prod. Building images and starting the stack — the first"
echo "build takes a few minutes."
$COMPOSE up -d --build

echo
echo "Waiting for the API to come up..."
tries=0
until $COMPOSE exec -T api node -e "fetch('http://localhost:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
  tries=$((tries + 1))
  if [ "$tries" -ge 30 ]; then
    echo "The API didn't come up in time — check '$COMPOSE logs api'." >&2
    exit 1
  fi
  sleep 2
done

echo
echo "== Done =="
echo "Visit https://$WEB_DOMAIN/setup to create the first (admin) account."
echo "Caddy is issuing TLS certificates automatically — the first request"
echo "to each domain may take a few seconds while that happens."
