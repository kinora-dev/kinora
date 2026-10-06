---
title: Playwright reporter
description: Auto-upload every Playwright run to kinora with the @kinora/reporter package.
---

`@kinora/reporter` is a Playwright reporter that uploads your results to kinora at the end of
every run: pass rates, trends, flaky tests, and the full trace for failures. It runs on `onEnd`,
posts the normalized run, then uploads the `trace.zip` for each test that produced one.
**Upload never fails your test run.**

## Install

```bash
pnpm add -D @kinora/reporter
# or: npm i -D @kinora/reporter
```

`@playwright/test` (>=1.40) is a peer dependency.

## Usage

Add it to `playwright.config.ts`:

```ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [['@kinora/reporter', { project: { slug: 'web-app' } }]],
  // enable tracing so failures upload a trace
  use: { trace: 'on-first-retry' },
})
```

The token comes from the environment (keep it out of the config file); the server URL defaults
to the hosted cloud:

```bash
KINORA_TOKEN=<token> npx playwright test
```

Create an API token in the dashboard under **Settings → Workspace**. Self-hosting? Point at your
server with `KINORA_URL` - see [Self-hosting](/self-hosting/).

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `project` | `{ slug: string, name?: string }` | required | Target project. `name` defaults to `slug`. |
| `url` | `string` | env `KINORA_URL`, then cloud | kinora server base URL. Set for self-host. |
| `token` | `string` | env `KINORA_TOKEN` | Project API token. Prefer the env var. |
| `git` | `{ sha?, branch?, baseBranch?, repoUrl? }` | auto on GitHub Actions / GitLab CI | Git metadata. `repoUrl` links a sha to its commit; `baseBranch` powers "regression vs base" in the PR comment. |
| `ci` | `{ provider?, runUrl?, runNumber? }` | auto on GitHub Actions / GitLab CI | CI metadata for the run. |
| `prComment` | `boolean \| { label?, policy? }` | off | Post/update a summary comment on the GitHub PR or GitLab MR. See [PR comments](/guides/pr-comments/). |

On GitHub Actions and GitLab CI, `git` and `ci` are filled from the standard `GITHUB_*` / `CI_*`
env vars (including the repo URL, so shas link to their commit in the dashboard). On a GitLab merge
request pipeline, the branch is the MR source branch and the base branch its target. Pass them
explicitly on other CI providers.

## CI example (GitHub Actions)

```yaml
- run: npx playwright test
  env:
    KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
```

## CI example (GitLab CI)

```yaml
e2e:
  script:
    - npx playwright test # KINORA_TOKEN is a masked CI/CD variable
```

## Notes

- If `KINORA_TOKEN` is missing, the reporter logs a warning and skips the upload, so local runs
  aren't affected. `KINORA_URL` is optional (defaults to the hosted cloud).
- Traces are uploaded only for tests that produced one, so enable `trace` in your Playwright
  config (`on-first-retry`, `retain-on-failure`, etc.).
- Cross-run test identity is the file + title path + Playwright project name, so history stays
  stable as long as those don't change.

## When to use the CLI instead

If your results are produced in one CI job and uploaded from another, or you want to bulk-import
a backlog, use the [CLI](/guides/cli/) instead.
