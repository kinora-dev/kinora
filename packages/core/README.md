# @kinora/core

Shared contract layer and helpers for [kinora](https://github.com/kinora-dev/kinora), a dashboard for Playwright test reports across projects and over time.

This is the package every other part of kinora depends on, so a test keeps a stable identity no matter how it was uploaded: the [`reporter`](https://www.npmjs.com/package/@kinora/reporter) and [`cli`](https://www.npmjs.com/package/@kinora/cli) use it to normalize Playwright output and POST it, and the server and dashboard use it to validate and shape that data. It is MIT so the libraries you embed in your own test suite can depend on it.

## Install

```bash
npm i @kinora/core
```

## What's inside

**Contracts** (zod schemas + inferred types):

- `contracts/ingest` - the wire payload uploaded to `POST /api/v1/runs` (`ingestRunSchema`, `IngestRun`).
- `contracts/kinora` - the stored / dashboard shapes (`manifestSchema`, `runReportSchema`, `projectHistorySchema`, `runComparisonSchema`, ...) and `SCHEMA_VERSION`, stamped on every run so the stored shape stays in sync.
- `contracts/playwright` - the raw Playwright JSON report shape (`playwrightReportSchema`).

**Ingest client** - what the reporter and CLI build on:

- `ingestPlaywrightReport(json)` - turn a raw Playwright JSON report into a normalized `IngestRun`.
- `buildIngestRun(...)` / `createIngestClient(...)` - assemble a run payload and POST it (plus trace artifacts).

**Helpers** (pure):

- `makeTestKey(file, titlePath, projectName)` - the cross-run identity of a test. The reporter and CLI must produce the same key or history breaks.
- `buildTestHistories(reports)` - fold `RunReport[]` into per-test timelines.
- `compareRuns(base, head)` - diff two runs (newly failing, fixed, newly flaky, still failing).
- Aggregation: `passRate`, `runHealth`, `trend`, `denom`, `collectBranches`, `collectTags`, `filterRuns`, `formatDuration`, `formatPct`.
- Status: `isUnstable`, `pwStatusMeta`, ...

## Stable test identity

`makeTestKey` is the cross-run key. The reporter rebuilds it from the Playwright suite tree; the CLI derives it from `results.json` via `ingestPlaywrightReport`. Both must produce the same key, so a test's history stays continuous regardless of the upload path.

## License

MIT
