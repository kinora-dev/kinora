---
title: Environment variables
section: Reference
description: Every environment variable the kinora server reads, with defaults and when each is required.
---

This is the full reference for the **server process** environment. If you run the self-host Docker
Compose bundle, you configure a friendlier subset (`PUBLIC_URL`, `WEB_PORT`, ...) that maps onto
these internally - see [Configuration](/self-hosting/configuration/). Run the server directly and
these are the variables it reads.

Config is validated at startup (zod); a missing required variable, or `KINORA_CLOUD=true` without
its Polar variables, stops the server from booting.

## Core

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `NODE_ENV` | yes | - | `development` or `production`. |
| `PORT` | yes | - | Port the server listens on. |
| `BASE_URL` | yes | - | The server's own public URL. Drives auth callbacks and absolute links. |
| `WEB_ORIGIN` | yes | - | The dashboard origin. Used to build run URLs and email links. |
| `AUTH_SECRET` | yes | - | Session secret. Generate one: `openssl rand -hex 32`. |
| `KINORA_CLOUD` | no | `false` | Cloud mode (enables Polar billing). `false` = self-host, every feature unlimited. |
| `KINORA_DEMO` | no | `false` | Public read-only demo: auto-session as the seeded demo user, no mutations/ingest. |
| `INGEST_RATE_LIMIT` | no | `600` | Ingest requests per minute per client IP (DoS backstop). Raise for pathological suites. |
| `TRPC_RATE_LIMIT` | no | `300` | Dashboard requests per minute per client IP. Raise it when many users share one IP (office NAT). |

## Cookies

| Variable | Required | Notes |
| --- | --- | --- |
| `COOKIE_DOMAIN` | conditional | Share the session cookie across subdomains (e.g. `.kinora.dev` for `app.`/`api.`). Leave unset for single-origin self-host (host-only cookie). **Required** when `KINORA_CLOUD=true` in production. |

## Database (Postgres)

| Variable | Required | Notes |
| --- | --- | --- |
| `POSTGRES_HOST` | yes | Database host. |
| `POSTGRES_PORT` | yes | Database port. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | yes | Credentials and database name. |

## Artifact storage

Leave the `S3_*` variables unset to store artifacts on local disk. Set **all five** to use an
S3-compatible store instead. See [Storage & artifacts](/self-hosting/storage/).

| Variable | Default | Notes |
| --- | --- | --- |
| `STORAGE_DIR` | `.data/artifacts` | Local directory for artifacts when S3 is not configured. |
| `S3_ENDPOINT` / `S3_REGION` / `S3_BUCKET` | - | S3-compatible endpoint, region, bucket. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | - | S3 credentials. |

## Social login (optional)

A provider is enabled only when **both** its id and secret are set. Leave empty for email +
password only.

| Variable | Notes |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth. |

## Email (SMTP, optional)

`SMTP_HOST`, `SMTP_PORT`, and `SMTP_FROM` together enable email (verification, password reset,
invitations, and alert emails). Leave `SMTP_HOST` empty to disable all email flows.

| Variable | Notes |
| --- | --- |
| `SMTP_HOST` | SMTP server host. Empty disables email. |
| `SMTP_PORT` | SMTP port. |
| `SMTP_USER` / `SMTP_PASS` | Credentials (optional; some relays need none). |
| `SMTP_FROM` | From address, e.g. `kinora <no-reply@example.dev>`. |

## Slack (optional)

| Variable | Notes |
| --- | --- |
| `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` | The "Add to Slack" OAuth app. Without it, Slack alerts fall back to a manually pasted webhook URL. |

## Cloud billing (Polar)

Required when `KINORA_CLOUD=true`; unused on self-host. The server refuses to boot in cloud mode
without all four.

| Variable | Notes |
| --- | --- |
| `POLAR_ACCESS_TOKEN` | Polar API token. |
| `POLAR_WEBHOOK_SECRET` | Verifies Polar webhooks. |
| `POLAR_PRODUCT_TEAM_ID` / `POLAR_PRODUCT_PRO_ID` | Polar product ids for the paid plans. |

## Observability (optional)

| Variable | Notes |
| --- | --- |
| `SENTRY_DSN` | Server error reporting. Empty disables it. |

## Feedback tracker (cloud-only)

Powers the in-app "Send feedback" form. Cloud-only: a self-host instance never posts to the Kinora
issue tracker, so these are ignored unless `KINORA_CLOUD=true`.

| Variable | Notes |
| --- | --- |
| `FEEDBACK_TRACKER_API_KEY` / `FEEDBACK_TRACKER_PROJECT_ID` / `FEEDBACK_TRACKER_WORKSPACE_ID` / `FEEDBACK_TRACKER_API_URL` | Private task tracker credentials and endpoint. Leave empty for self-host. |
