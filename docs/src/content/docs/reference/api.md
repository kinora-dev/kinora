---
title: REST API
section: Reference
description: The plain-REST ingest and read API, authed by an API key. What the reporter, CLI, and MCP server call.
---

kinora's public API is plain REST, so any CI provider, `curl`, or language can push results and
read them back. The [reporter](/guides/reporter/) and [CLI](/guides/cli/) call the ingest
endpoints for you; the [MCP server](/guides/mcp/) calls the read endpoints. Use this reference
when you want a custom integration.

## Base URL

- Cloud: `https://api.kinora.dev`
- Self-host: your server's origin.

## Authentication

Every request needs an API token in the `Authorization` header:

```
Authorization: Bearer <token>
```

Create a token in the dashboard under **Settings → Workspace**. The token is scoped to the
workspace that owns it; all requests read and write only that workspace's data.

Requests are rate-limited per client IP (`INGEST_RATE_LIMIT`, default 600/min).

## Ingest

### POST /api/v1/runs

Upload one normalized run. The project is created automatically the first time its `slug` is seen.
The body is the normalized run JSON that `@kinora/core` produces (the reporter and CLI build it);
its top-level shape:

```json
{
  "project": { "slug": "web-app", "name": "Web App" },
  "run": {
    "startedAt": "2026-07-18T10:00:00.000Z",
    "duration": 42000,
    "counts": { "total": 126, "expected": 120, "unexpected": 2, "flaky": 1, "skipped": 3 },
    "playwrightVersion": "1.50.0",
    "git": { "sha": "…", "branch": "main", "baseBranch": "main", "repoUrl": "…" },
    "ci": { "provider": "github", "runUrl": "…", "runNumber": "42" },
    "shards": 4
  },
  "tests": [{ "testKey": "…", "title": "…", "status": "expected", "…": "…" }]
}
```

Query parameters:

| Param | Effect |
| --- | --- |
| `backfill=1` | Historical import: suppresses alerts and stays unmetered (billing follows `run.startedAt`). |
| `regression=1` | Compute regression vs the base branch and include it in the response. |

Send an `Idempotency-Key` header (any unique string, up to 255 characters) to make retries safe:
a second upload with the same key for the same project returns the run already stored, with a
`200` instead of a `201`, and is neither counted nor alerted again. The reporters and the CLI send
one per run. Sharded uploads ignore it, a re-sent shard already replaces its slot.

Response `201`:

```json
{ "projectId": "…", "runId": "…", "tests": 126, "runUrl": "https://app.kinora.dev/projects/web-app/runs/…", "regression": { "…": "…" } }
```

`runUrl` is always returned; `regression` only when `regression=1` was passed.

Errors: `400` invalid body, including more than 50,000 tests in one run · `401` invalid API key · `402` plan limit reached (cloud free tier) · `413` body over 25 MB.

#### Sharded runs

To upload each shard of a CI run on its own, add three optional fields to `run`. Uploads sharing a
`groupKey` land in one run, and `shard.current` is the slot the upload fills:

```json
{
  "run": {
    "groupKey": "gh-1234567890",
    "attempt": 1,
    "shard": { "current": 2, "total": 4 },
    "…": "…"
  }
}
```

| Field | Meaning |
| --- | --- |
| `groupKey` | Identifies the CI run, never one attempt of it (the GitHub run id, the GitLab pipeline id). Requires `shard`. Up to 200 characters. |
| `attempt` | The CI attempt that produced the upload, `1` by default. A higher attempt for a slot already filled replaces that slot's tests, and a test that failed on the earlier attempt and passes now is stored as flaky. The same attempt again (a retried request) replaces them as is, and a lower one is ignored. |
| `shard` | `{ current, total }`, 1-based, from Playwright's `--shard`. The first upload sets `total`. |

The response then also carries the run as it stands:

```json
{ "…": "…", "status": "open", "shardProgress": { "landed": 2, "total": 4 }, "counts": { "…": "…" }, "flaky": [{ "testKey": "…", "title": "…", "file": "…" }] }
```

`status` is `open` until every shard landed, then `complete`. A run still `open` after
`KINORA_SHARD_TIMEOUT_MINUTES` (default 120, self-host) is closed as `incomplete`, and a late shard
still completes it. `counts` and `flaky` cover every shard landed so far; `flaky` also carries
`rerunAttempt` for a test that only passed on a re-run. Alerts fire once, on completion or when the
run is closed `incomplete`. A re-run of a slot that already landed adds no results to your usage
and is never turned away by the free plan's result limit. `regression` is only computed once the
run is complete. Without `groupKey`, an upload is a run of its own, as before.

The read routes below return `status` and `shardProgress` for a run assembled this way: on the run
summaries, and under `meta` in a full report.

### POST /api/v1/runs/:runId/artifacts

Upload a `trace.zip` (or other binary) for a run, as `multipart/form-data`. Send the file part
plus a `testKey` field to link it to a test, and an optional `name` field.
An `Idempotency-Key` header works as on runs: a retry with the same key for the same run returns
the stored artifact's URL with a `200`, without reading the body again.

Response `201`:

```json
{ "url": "https://…/trace.zip" }
```

Errors: `404` run not found · `400` no file part · `413` file over 100 MB.

## Read

All read routes are `GET`, Bearer-authed, and scoped to your workspace.

### GET /api/v1/projects

Every project with its latest run summary.

```json
{ "projects": [{ "id": "web-app", "name": "Web App", "description": "Customer-facing web app", "latestRun": { "…": "…" } }] }
```

`id` is the project slug.

### GET /api/v1/projects/:slug/runs

Run summaries, newest first. Query `limit` (default 50, max 200).

```json
{ "runs": [{ "…": "…" }] }
```

### GET /api/v1/projects/:slug/runs/:runId

The full report for one run. Use `latest` as `:runId` for the most recent run. Returns counts,
git/CI metadata, and every test with its status and failures.

### GET /api/v1/projects/:slug/failures

The failing and flaky tests of a run (defaults to the latest). Query `runId` to target a specific
run.

```json
{ "runId": "…", "startedAt": "…", "counts": { "…": "…" }, "failures": [{ "status": "unexpected", "…": "…" }] }
```

### GET /api/v1/projects/:slug/history

Per-test history over the project's latest 500 runs: counts, rates, and one point per run.

- With `testKey`: that one test, with every point.
- Without it: every test. Counts and rates still cover all 500 runs, but each test only carries the
  points its health reads: its last 20 runs and, for a test failing right now, its whole failing
  streak. Query `testKey` for a test's full timeline.

```json
{ "histories": [{ "testKey": "…", "…": "…" }] }
```

## Examples

Upload a run with `curl`:

```bash
curl -X POST https://api.kinora.dev/api/v1/runs \
  -H "Authorization: Bearer $KINORA_TOKEN" \
  -H "Content-Type: application/json" \
  --data @run.json
```

Read the latest run's failures:

```bash
curl https://api.kinora.dev/api/v1/projects/web-app/failures \
  -H "Authorization: Bearer $KINORA_TOKEN"
```
