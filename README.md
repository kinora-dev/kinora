# kinora

A dashboard for your Playwright tests - across projects and over time - with an embedded trace viewer.

**[Live demo](https://demo.kinora.dev)** (read-only, no sign-up) · **[Open a trace](https://kinora.dev/trace)** (no account) · [Website](https://kinora.dev) · [Docs](https://docs.kinora.dev) · [Cloud](https://app.kinora.dev)

Playwright ships a great HTML report for a single run. kinora sits one level up: push every CI run to a kinora server and get one place to track pass rates, spot trends, and surface flaky tests over time. Failing tests get a **View trace** button that opens the full Playwright trace (DOM / timeline / network / console) right in the dashboard, no separate tooling.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/overview-light.png">
  <img alt="Overview" src="docs/screenshots/overview-dark.png">
</picture>

## Features

### Trends over time

Push from CI and kinora keeps the history: pass rate, run count and duration per project, a sparkline trend, and one colored strip per run, so a slow drift shows long before it breaks the build.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/project-light.png">
  <img alt="Per-project page with pass rate, trend sparkline and per-run history strips" src="docs/screenshots/project-dark.png">
</picture>

### Flakiness

Every test gets a flaky rate and a fail rate computed across its run history. Flip on **Unstable only** to see what is quietly costing you retries, and spot the tests newly broken or newly flaky since the last run.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/tests-light.png">
  <img alt="Tests page listing per-test flaky rate and fail rate across runs with an unstable-only filter" src="docs/screenshots/tests-dark.png">
</picture>

### Per-test history

Each test keeps a stable identity however it was uploaded, so you can follow one test run-to-run: when it started flaking, when it was fixed, and how long it has been green.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/test-history-light.png">
  <img alt="Per-test history with a status timeline, pass and flaky rates, and a list of failures and flakes" src="docs/screenshots/test-history-dark.png">
</picture>

### Run-to-run compare

Diff any two runs: newly failing, fixed, newly flaky, and still failing, grouped for you.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/compare-light.png">
  <img alt="Run-to-run comparison" src="docs/screenshots/compare-dark.png">
</picture>

### Embedded trace viewer

Failing tests get a **View trace** button that opens the full Playwright trace inline - DOM, timeline, network, console - plus a **Copy prompt** to hand the failure to an LLM.

The same viewer also runs standalone at **[kinora.dev/trace](https://kinora.dev/trace)** - drop a `trace.zip` and it opens in your browser. No account, and the file is never uploaded.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/trace-viewer-light.png">
  <img alt="Embedded Playwright trace viewer" src="docs/screenshots/trace-viewer-dark.png">
</picture>

## Alerts

Get notified when a run brings new failures or regressions. Each project can post to Slack, an email address, or a custom webhook, with an every-run / on-failure / on-regression policy.

## Desktop app

A desktop app that signs into your account and opens straight on the latest run's failures. Re-run a failing test locally with your repo's own Playwright, jump to the source in your editor, copy a ready-to-paste AI prompt, or open the full trace inline. It also opens any local `trace.zip` straight from your file manager, with no account, as a self-contained replacement for `playwright show-trace`.

[Download](https://github.com/Kinora-dev/kinora/releases/latest) for macOS, Windows, or Linux. Auto-updates from there.

<picture>
  <source media="(prefers-color-scheme: light)" srcset="docs/screenshots/desktop-light.png">
  <img alt="kinora desktop app showing a project's failing tests with re-run, open-in-editor, copy-prompt and view-trace actions" src="docs/screenshots/desktop-dark.png">
</picture>

## Packages

Monorepo, fair source: the deployable surface is FSL-1.1-MIT, the client libraries you embed are MIT.

| Package                                         | Role                                                                     | License     |
| ----------------------------------------------- | ------------------------------------------------------------------------ | ----------- |
| [`@kinora/server`](packages/server)             | Hono + tRPC API, better-auth, Drizzle/Postgres - ingest + dashboard data | FSL-1.1-MIT |
| [`@kinora/web`](packages/web)                   | Vue 3 dashboard (runs, history, flakiness, compare, alerts, billing)     | FSL-1.1-MIT |
| [`@kinora/desktop`](packages/desktop)           | Electron app: cloud failures dashboard + local trace viewer              | FSL-1.1-MIT |
| [`@kinora/trace-viewer`](packages/trace-viewer) | Vendored Playwright trace engine (Apache-2.0) + our Vue UI               | MIT         |
| [`@kinora/reporter`](packages/reporter)         | Playwright reporter - auto-uploads on `onEnd`                            | MIT         |
| [`@kinora/cli`](packages/cli)                   | Manual upload of a `results.json`                                        | MIT         |
| [`@kinora/mcp`](packages/mcp)                   | MCP server - exposes failures + history to coding agents                 | MIT         |
| [`@kinora/core`](packages/core)                 | zod contracts + normalize + ingest client (shared)                       | MIT         |
| [`@kinora/ui`](packages/ui)                     | Shared shadcn-vue design system                                          | MIT         |

## Send your tests

### Reporter (recommended)

Auto-uploads at the end of every `playwright test` run. One line in your config:

```ts
// playwright.config.ts
export default defineConfig({
  reporter: [['@kinora/reporter', { project: { slug: 'web-app' } }]],
  // enable tracing so View trace works
  use: { trace: 'on-first-retry' },
})
```

Set the token via env (keep it out of the config / in CI secrets):

```bash
KINORA_TOKEN=<token> npx playwright test
```

On GitHub Actions, git and CI metadata are filled in automatically. See [`@kinora/reporter`](packages/reporter) for all options and the CI example. Self-hosting? Point it at your server with `KINORA_URL` ([selfhost/README.md](selfhost/README.md)).

### CLI (manual)

For setups without the reporter, or to upload an existing `results.json` from a separate CI job:

```bash
# playwright.config.ts: reporter: [['json', { outputFile: 'results.json' }]]
npx @kinora/cli upload results.json --project web-app --token <project-token>
```

The CLI can also bulk-import a backlog of historical reports (`kinora import <dir>`). See [`@kinora/cli`](packages/cli) for all flags and the CI example.

## Debug from your agent (MCP)

Point a coding agent (Claude Code, Cursor, Claude Desktop, and others) at your kinora data with the [`@kinora/mcp`](packages/mcp) server. It runs locally over stdio and pulls the last run's failures - error, `file:line`, and the trace - plus per-test flaky-vs-regression history, so the agent can go straight to the fix.

Add it to your agent's MCP config with a kinora API token:

```json
{
  "mcpServers": {
    "kinora": {
      "command": "npx",
      "args": ["-y", "@kinora/mcp"],
      "env": { "KINORA_TOKEN": "<token>", "KINORA_URL": "https://api.kinora.dev" }
    }
  }
}
```

`KINORA_URL` defaults to the hosted cloud; set it to your own origin for self-host. See [`@kinora/mcp`](packages/mcp) for the tool list.

## Development

Run the whole stack locally.

```bash
pnpm install

# 1. server + database
cd packages/server
cp .env.example .env
docker compose up -d            # Postgres on :5436
pnpm migrate latest             # create tables
pnpm db:seed                    # seed a demo account + data, prints login + an API token
pnpm dev                        # server on :3000

# 2. web
cd packages/web
cp .env.example .env
pnpm dev                        # dashboard on :5173

# 3. trace viewer (from the repo root)
pnpm dev:viewer                 # trace viewer on :5174
```

Open http://localhost:5173 and sign in with the seeded credentials (`demo@kinora.dev` / `password123`). Use the printed API token to push real runs from a project via the reporter or CLI.

## Self-hosting

Run the whole stack with one `docker compose` (Postgres + server + dashboard, single origin, local-FS artifacts, no S3). See [`selfhost/README.md`](selfhost/README.md) for the quickstart, configuration, sending tests, custom domains, upgrades, and backups.

## Licensing

kinora is fair source, the deployable product (`server`, `web`, `desktop`) is **FSL-1.1-MIT**, the client libraries (`reporter`, `cli`, `mcp`, `core`, `ui`) and the trace viewer are **MIT**. The trace engine under `packages/trace-viewer/src/core` and `src/sw` is vendored from [microsoft/playwright](https://github.com/microsoft/playwright) (Apache-2.0).
