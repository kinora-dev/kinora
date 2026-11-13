---
title: CLI upload
description: Upload a Playwright json report to kinora from CI, or bulk-import a backlog, with @kinora/cli.
---

`@kinora/cli` uploads a Playwright `json` report to kinora. Use it when you can't run the
[reporter](/guides/reporter/) inline (results produced in one CI job, uploaded from another), or
to bulk-import a backlog of historical reports.

## Upload a single report

Produce `results.json` with Playwright's built-in json reporter:

```ts
// playwright.config.ts
reporter: [['json', { outputFile: 'results.json' }]]
```

Then upload it:

```bash
npx @kinora/cli upload results.json --project web-app --token <project-token>
```

Create a project API token in the dashboard under **Settings → Workspace**. Auth can also come
from the environment (`KINORA_TOKEN`, `KINORA_URL`). Self-hosting? Point at your server with
`--url` / `KINORA_URL` - see [Self-hosting](/self-hosting/).

If the kinora server is unreachable or answers `502`, `503`, `504`, `408` or `429` (a deploy, a
restart), the upload is retried for about a minute with growing waits, logging each one. Retries
reuse the same `Idempotency-Key`, so a run is never stored twice.

## Bulk import (historical backfill)

Import every `*.json` report under a directory in one go, useful for seeding history from an
existing archive:

```bash
npx @kinora/cli import ./reports --project web-app --token <project-token> --concurrency 8
```

- **Billing follows test execution date**, so runs from past periods are free and don't consume
  your current quota; only current-period runs count.
- Imported runs **skip alerts** (no notification spam).
- **Traces are not uploaded** by `import`: a JSON-only archive has no `trace.zip` next to it.
  History (pass rates, trends, flaky detection) still works without them.

## Options

```
--project <slug>      required, target project slug
--token <token>       project API token (or env KINORA_TOKEN)
--url <url>           server base URL (or env KINORA_URL; default: hosted cloud, set for self-host)
--name <name>         project display name (default: slug)
--git-sha <sha>
--git-branch <branch>
--git-repo-url <url>  remote URL (https://github.com/org/repo) to link shas to commits
--ci-provider <name>
--ci-run-url <url>
--ci-run-number <n>
--git-base-branch <b> PR base branch (auto-detected in CI); powers "regression vs base"
--pr-comment          post/update a summary on the GitHub PR or GitLab MR (see PR comments guide)
--pr-label <label>    distinguish matrix legs that share one PR
--pr-policy <policy>  always (default) | on-failure (no new comment on green runs)
--upload-attachments <kinds>
                      comma-separated: trace, snapshot (both default), video, screenshot.
                      snapshot = images of a failed screenshot assertion (comparison view)
--group-key <key>     sharded report: the run its shards are assembled into
                      (default: env KINORA_GROUP_KEY, then GITHUB_RUN_ID / CI_PIPELINE_ID)
--no-group            upload a sharded report as a run of its own
--base-url <url>      the app's baseURL, repeatable (one per Playwright project), or env
                      KINORA_BASE_URL (comma-separated). See below
--concurrency <n>     parallel uploads for bulk import (default: 6)
-h, --help
```

A JSON report does not carry the `baseURL` of your Playwright projects. Pass it with `--base-url`
so kinora tells an [environment incident](/guides/environment-incidents/) on your app's host from
a third-party host going down. Without it, the host most failures named stands in for it.

On GitHub Actions and GitLab CI, `git` and `ci` metadata (including the repo URL) auto-detect from
the standard `GITHUB_*` / `CI_*` env vars; the flags override them. Pass the flags explicitly on
other CI providers.

## CI example (GitHub Actions)

```yaml
- run: PLAYWRIGHT_JSON_OUTPUT_NAME=results.json npx playwright test --reporter=json
- run: npx @kinora/cli upload results.json --project web-app
  if: always()
  env:
    KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
    # git + ci metadata (sha, branch, repo URL, run link) auto-detect from GITHUB_*
```

## CI example (GitLab CI)

```yaml
e2e:
  script:
    - PLAYWRIGHT_JSON_OUTPUT_NAME=results.json npx playwright test --reporter=json
  after_script:
    # KINORA_TOKEN is a masked CI/CD variable; git + ci metadata auto-detect from CI_*
    - npx @kinora/cli upload results.json --project web-app
```

For posting a summary on the pull request, see [PR comments](/guides/pr-comments/).

## Sharded runs

Upload each shard's report from its own job: the JSON report records which shard produced it
(`--shard`), and kinora assembles the shards of one CI run into a single run, exactly like the
reporter. Grouping, partial and incomplete runs, and re-runs work as described in
[Sharded runs](/guides/reporter/#sharded-runs).

```yaml
- run: PLAYWRIGHT_JSON_OUTPUT_NAME=results.json npx playwright test --shard=${{ matrix.shard }} --reporter=json
- run: npx @kinora/cli upload results.json --project web-app
  if: always()
  env:
    KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
```

`kinora import` never groups: each imported report stays a run of its own.

## Balanced shards

Playwright's `--shard` splits a suite by test count, so one shard can draw every slow test and
hold up the whole CI run. `kinora shard` splits it by duration instead: it reads each test's
median duration over the project's latest runs, then writes one
[test list](https://playwright.dev/docs/test-cli#test-list) per shard, each with about the same
total time.

Plan the shards once, in a job of its own, and hand the lists to the test jobs. Two jobs computing
their own plan could read different durations, if a run lands in between, and then skip or repeat
tests.

```yaml
jobs:
  plan:
    runs-on: ubuntu-latest
    steps:
      # ... checkout, install (no browsers needed)
      - run: npx playwright test --list --reporter=json > list.json
      - run: npx @kinora/cli shard --list list.json --total 4 --project web-app
        env:
          KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
      - uses: actions/upload-artifact@v4
        with:
          name: shards
          path: shards/

  e2e:
    needs: plan
    strategy:
      matrix:
        shard: [1, 2, 3, 4]
    steps:
      # ... checkout, install
      - uses: actions/download-artifact@v4
        with:
          name: shards
          path: shards/
      - run: npx playwright test --test-list shards/shard-${{ matrix.shard }}.txt
        env:
          KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
          KINORA_SHARD: ${{ matrix.shard }}/4
```

A run split by a test list does not record a shard, so set `KINORA_SHARD=<shard>/<total>`: the
reporter and `kinora upload` read it to assemble the shards into one run, as with `--shard`.

```
--list <file>         required, output of `playwright test --list --reporter=json`
--total <n>           required, number of shards
--project <slug>      read durations from this kinora project (with a token)
--from-report <file>  read durations from a previous Playwright JSON report instead, no account needed
--runs <n>            latest kinora runs to read durations from (default: 30)
--out-dir <dir>       where shard-1.txt ... shard-N.txt go (default: shards)
--granularity <g>     file (default) | test
```

- **Files stay whole by default**, which keeps `describe.serial` groups and per-file `beforeAll`
  hooks together. With `fullyParallel` suites, `--granularity test` balances single tests. A file
  whose test titles a list entry cannot name exactly (a title containing `›`, or one that is also
  a `describe` title) still stays whole.
- **Tests without history**, new or renamed, are estimated at the median of the known durations.
- **Skipped results and [environment incidents](/guides/environment-incidents/)** are left out of
  the durations.
- **If kinora cannot be reached**, the command warns and splits by test count, so CI still runs.
- **A shard can be empty** when there are fewer files than shards. Playwright then fails with "No
  tests found": lower `--total`, or pass `--pass-with-no-tests`.
