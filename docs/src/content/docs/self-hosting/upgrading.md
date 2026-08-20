---
title: Upgrading & backups
description: Pull the latest kinora images, restart the stack, and back up your data volumes.
---

## Upgrading

```bash
docker compose pull
docker compose up -d
```

Migrations apply automatically on start (the one-shot `migrate` service runs before the server).
There is no separate migration step to run.

`docker compose pull` follows `KINORA_VERSION` in your `.env`. On `latest` it fetches the newest
release; if you pinned a version, bump it there first. Rolling back is the same move in reverse:
set the older tag and `docker compose up -d`. Migrations are forward-only, so a rollback across a
schema change needs a database restore from your backup.

## Backups

Two named volumes hold all state:

- `kinora-db` - the Postgres database (projects, runs, tests, users).
- `kinora-artifacts` - uploaded `trace.zip`, screenshots, and videos (when using local storage;
  with an [S3 store](/self-hosting/storage/) the artifacts live in your bucket instead).

Back them up with your usual volume backup workflow, or `pg_dump` for the database:

```bash
docker compose exec -T postgres pg_dump -U "$POSTGRES_USER" "$POSTGRES_DB" > kinora-backup.sql
```

Restore by piping a dump back into `psql` on a fresh database, then bring the stack up.
