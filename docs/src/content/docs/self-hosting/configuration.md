---
title: Configuration
description: Every environment variable for a self-hosted kinora, copied from selfhost/.env.example.
---

Self-host is configured entirely through `.env` (read by `docker-compose.yml`). Copy
`.env.example` to `.env` and edit it. Below is every variable.

## Required

| Variable | Notes |
| --- | --- |
| `PUBLIC_URL` | The URL users reach kinora at. Drives links, cookies, and artifact URLs. Default `http://localhost:8080`. Server-side only: changing it needs a restart, not a rebuild. |
| `AUTH_SECRET` | Session secret. Generate one: `openssl rand -hex 32`. |
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` | Database credentials. |

## Server & networking

| Variable | Default | Notes |
| --- | --- | --- |
| `KINORA_VERSION` | `latest` | Image tag to run. Pin a version (e.g. `0.1.0`) to control upgrades. |
| `WEB_PORT` | `8080` | Host port the web container binds to. Match `PUBLIC_URL`. |
| `POSTGRES_PORT` | `5432` | Postgres port. `POSTGRES_HOST` is set to the compose service automatically. |
| `KINORA_CLOUD` | `false` | Keep `false` for self-host: no billing, every feature unlimited. |
| `COOKIE_DOMAIN` | *(empty)* | Leave empty for single-origin (host-only cookie). |

## Email (optional)

Enables email verification, password reset, invitations, and alert emails. Any SMTP provider
works (Resend, Brevo, SES, self-hosted). Leave `SMTP_HOST` empty to disable all email flows.

| Variable | Default | Notes |
| --- | --- | --- |
| `SMTP_HOST` | *(empty)* | SMTP server host. Empty disables email. |
| `SMTP_PORT` | `587` | SMTP port. |
| `SMTP_USER` / `SMTP_PASS` | *(empty)* | SMTP credentials. |
| `SMTP_FROM` | *(example)* | From address, e.g. `kinora <no-reply@example.dev>`. |

## Social login (optional)

Leave empty to use email + password only.

| Variable | Notes |
| --- | --- |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | GitHub OAuth. |

## Artifact storage (optional)

Leave the `S3_*` variables empty to store `trace.zip` on a local volume (the default). Set all
five to use an S3-compatible store instead. See [Storage & artifacts](/self-hosting/storage/).

| Variable | Notes |
| --- | --- |
| `S3_ENDPOINT` | S3-compatible endpoint URL. |
| `S3_REGION` | Region. |
| `S3_BUCKET` | Bucket name. |
| `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY` | Credentials. |
