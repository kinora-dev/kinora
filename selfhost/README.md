# Self-hosting kinora

Run the whole stack (Postgres + server + dashboard) with one `docker compose`, on a single
origin, with trace artifacts on a local volume.

## Quickstart

The images are prebuilt, so there is nothing to clone and nothing to compile. Two files and one
command:

```bash
mkdir kinora && cd kinora
base=https://raw.githubusercontent.com/Kinora-dev/kinora/main/selfhost
curl -fsSLO "$base/docker-compose.yml"
curl -fsSL -o .env "$base/.env.example"
# edit at least: PUBLIC_URL, AUTH_SECRET, POSTGRES_PASSWORD
docker compose up -d
```

Open `PUBLIC_URL` (default http://localhost:8080) and create your account. The first user owns
their workspace; invite teammates from Settings.

## What's here

- `docker-compose.yml` - Postgres, a one-shot migrate, the server, and the web container.
- `.env.example` - all configuration.
- `nginx.conf` - the web container's reverse proxy (serves the dashboard + trace viewer, proxies
  the API to the server). Already baked into the published web image; keep it around only to
  customize it (`- ./nginx.conf:/etc/nginx/conf.d/default.conf:ro` on the `web` service).
- `docker-compose.build.yml` - optional override to build the images from a clone instead of
  pulling them.

The images are `ghcr.io/kinora-dev/kinora-server` and `ghcr.io/kinora-dev/kinora-web`, published
for `linux/amd64` and `linux/arm64`. `KINORA_VERSION` in `.env` picks the tag. To build them
yourself from a checkout of this repo:

```bash
docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build
```

## How it works

Everything is **one origin**. The web container serves the dashboard and the embedded trace
viewer, and reverse-proxies `/api`, `/trpc`, and `/artifacts` to the server. So there is no CORS
to configure and the session cookie stays host-only (`COOKIE_DOMAIN` empty). Postgres data and
trace artifacts live in named volumes (`kinora-db`, `kinora-artifacts`). Migrations run
automatically (the `migrate` service) before the server starts.

## Configuration (`.env`)

| Var                                                   | Required | Notes                                                                      |
| ----------------------------------------------------- | -------- | -------------------------------------------------------------------------- |
| `KINORA_VERSION`                                      | no       | Image tag to run (default `latest`). Pin a version to control upgrades.    |
| `PUBLIC_URL`                                          | yes      | The URL users reach kinora at. Drives links, cookies, and artifact URLs.   |
| `WEB_PORT`                                            | no       | Host port for the web container (default 8080). Match `PUBLIC_URL`.        |
| `AUTH_SECRET`                                         | yes      | Session secret. `openssl rand -hex 32`.                                    |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes      | Database credentials.                                                      |
| `SMTP_*`                                              | no       | Enables email verification, password reset, invitations, and email alerts. |
| `GOOGLE_*` / `GITHUB_*`                               | no       | Social login. Leave empty for email + password only.                       |
| `S3_*`                                                | no       | Use an S3-compatible store instead of the local volume.                    |
| `KINORA_ARTIFACT_RETENTION_DAYS`                      | no       | Delete stored trace files older than N days, keep the runs. `0` = never.   |
| `KINORA_RETENTION_DAYS`                               | no       | Delete runs older than N days. `0` = never.                                |
| `KINORA_KEEP_LAST_RUNS`                               | no       | Keep only the N newest runs per project. `0` = unlimited.                  |

Self-host runs with `KINORA_CLOUD=false` (no billing; every feature, including alerts, is unlimited).

## Retention

Nothing is deleted by default. Traces are what fills the disk (a `trace.zip` carries the
screenshots and video of its test), so the first knob to reach for is
`KINORA_ARTIFACT_RETENTION_DAYS`: it deletes the stored files past N days but keeps the runs, so
pass rates, trends and flaky history stay intact. Old runs simply lose their "View trace" link.

```bash
# keep traces for 30 days, history forever
KINORA_ARTIFACT_RETENTION_DAYS=30
```

`KINORA_RETENTION_DAYS` and `KINORA_KEEP_LAST_RUNS` delete whole runs, history included.
`KINORA_KEEP_LAST_RUNS` counts per project, which is the one to use when your suites run on a
schedule and you only care about recent history. They combine: a run is deleted if either says so.

```bash
# traces for 14 days, runs for 180 days, at most 500 runs per project
KINORA_ARTIFACT_RETENTION_DAYS=14
KINORA_RETENTION_DAYS=180
KINORA_KEEP_LAST_RUNS=500
```

The server sweeps at startup and every 24h while at least one of the three is non-zero. To run
one immediately (also useful for the first sweep after enabling retention on a large instance):

```bash
docker compose exec server node dist/scripts/purge-expired-runs.mjs
```

## Send your tests

Point the reporter or CLI at your `PUBLIC_URL`:

```bash
# reporter (in playwright.config.ts: reporter: [['@kinora/reporter', { project: { slug: 'web-app' } }]])
KINORA_URL=https://kinora.example.com KINORA_TOKEN=<token> npx playwright test

# CLI
npx @kinora/cli upload results.json --project web-app \
  --url https://kinora.example.com --token <token>
```

Create the token in the dashboard under Settings -> Workspace. See the
[reporter](../packages/reporter) and [cli](../packages/cli) docs for all options.

## Own domain and HTTPS

Set `PUBLIC_URL` to your public https URL (e.g. `https://kinora.example.com`) and put the web
container behind your own TLS proxy (Caddy, Traefik, nginx, a load balancer, ...) forwarding to
`WEB_PORT`. The dashboard calls the API on whatever origin it is served from, so `PUBLIC_URL` is
server-side only: `docker compose up -d` is enough after changing it.

## Upgrades

```bash
docker compose pull
docker compose up -d
```

Migrations apply automatically on start. With `KINORA_VERSION` pinned, bump it in `.env` first.

## Backups

Two volumes hold all state:

- `kinora-db` - the Postgres database.
- `kinora-artifacts` - uploaded trace.zip / screenshots / videos.

Back them up with your usual volume backup workflow (or `pg_dump` for the database).
