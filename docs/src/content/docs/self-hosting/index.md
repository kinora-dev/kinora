---
title: Self-hosting kinora
description: Run the whole stack (Postgres + server + dashboard) with one docker compose, on a single origin.
---

Self-host runs the whole stack (Postgres + server + dashboard) with one `docker compose`, on a
single origin, with trace artifacts on a local volume. It runs with `KINORA_CLOUD=false`: no
billing, and every feature (including alerts) is unlimited.

## Quickstart

The images are prebuilt, so there is nothing to clone and nothing to compile. Grab the two files
from [`selfhost/`](https://github.com/Kinora-dev/kinora/tree/main/selfhost) and start the stack:

```bash
mkdir kinora && cd kinora
base=https://raw.githubusercontent.com/Kinora-dev/kinora/main/selfhost
curl -fsSLO "$base/docker-compose.yml"
curl -fsSL -o .env "$base/.env.example"
# edit at least: PUBLIC_URL, AUTH_SECRET, POSTGRES_PASSWORD
docker compose up -d
```

Open `PUBLIC_URL` (default `http://localhost:8080`) and create your account. The first user owns
their workspace; invite teammates from Settings.

## What's in the bundle

- `docker-compose.yml` - Postgres, a one-shot migrate, the server, and the web container.
- `.env.example` - all configuration.
- `nginx.conf` - the web container's reverse proxy: serves the dashboard + trace viewer and
  proxies the API to the server. Already baked into the published web image; keep it around only
  to customize it (mount it over `/etc/nginx/conf.d/default.conf`).
- `docker-compose.build.yml` - optional override to build the images from a clone instead of
  pulling them.

## Images

- `ghcr.io/kinora-dev/kinora-server`
- `ghcr.io/kinora-dev/kinora-web`

Both are published for `linux/amd64` and `linux/arm64`. `KINORA_VERSION` in `.env` picks the tag:
`latest` tracks the newest release, or pin a version (e.g. `0.1.0`) to control when you upgrade.
To build them yourself instead, from a clone of the repo:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## How it works

Everything is **one origin**. The web container serves the dashboard and the embedded trace
viewer, and reverse-proxies `/api`, `/trpc`, and `/artifacts` to the server. So there is no CORS
to configure and the session cookie stays host-only (`COOKIE_DOMAIN` empty). Postgres data and
trace artifacts live in named volumes (`kinora-db`, `kinora-artifacts`). Migrations run
automatically (the `migrate` service) before the server starts.

## Send your tests

Point the reporter or CLI at your `PUBLIC_URL`:

```bash
# reporter (in playwright.config.ts:
#   reporter: [['@kinora/reporter', { project: { slug: 'web-app' } }]])
KINORA_URL=https://kinora.example.com KINORA_TOKEN=<token> npx playwright test

# CLI
npx @kinora/cli upload results.json --project web-app \
  --url https://kinora.example.com --token <token>
```

Create the token in the dashboard under **Settings → Workspace**. See
[Getting started](/getting-started/) for the full setup.

## Custom domain and HTTPS

Set `PUBLIC_URL` to your public https URL (e.g. `https://kinora.example.com`) and put the web
container behind your own TLS proxy (Caddy, Traefik, nginx, a load balancer) forwarding to
`WEB_PORT`. The dashboard calls the API on whatever origin it is served from, so `PUBLIC_URL` is
server-side only and a restart is enough:

```bash
docker compose up -d
```

## Next

- [Configuration](/self-hosting/configuration/): every `.env` variable.
- [Storage & artifacts](/self-hosting/storage/): local volume vs S3-compatible store.
- [Upgrading & backups](/self-hosting/upgrading/): pull the new images and back up your volumes.
