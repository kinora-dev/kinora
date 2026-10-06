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
--pr-policy <policy>  always (default) | on-failure (skip the comment on green runs)
--concurrency <n>     parallel uploads for bulk import (default: 6)
-h, --help
```

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
