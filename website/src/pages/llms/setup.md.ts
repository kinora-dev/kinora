import type { APIRoute } from 'astro'
import { SITE } from '../../lib/site'

export const GET: APIRoute = () => {
  const url = SITE.url
  const app = SITE.app

  const body = `# Set up kinora for a Playwright project

You are a coding agent configuring [kinora](${url}) reporting in this repository. kinora ingests Playwright test results from CI, tracks pass rates, trends, and flaky tests over time, and opens the full trace inline for any failure. Follow the steps below, editing the repo's real files. Make the smallest change that wires reporting in, and never invent config the project doesn't already use.

## What you need from the user

- An **API token**. The user creates it in the kinora dashboard (${app}, Settings > Workspace) and provides it as the environment variable \`KINORA_TOKEN\`.
- Do **not** hardcode the token in any committed file. It is a secret. Your job is to reference \`KINORA_TOKEN\`; the user's job is to put its value in CI secrets and, for local runs, an untracked \`.env\`. Tell them to do this explicitly.
- If the user self-hosts kinora, you also need their server URL as \`KINORA_URL\`. On the hosted cloud, leave \`KINORA_URL\` unset (it defaults to the cloud).

## Step 0: choose the ingest path

Two paths derive the same cross-run test identity, so history stays stable either way. Pick one:

- **Reporter (default).** Use this unless a reason below applies. It runs inside the Playwright process and uploads the run plus the trace.zip for each failed/flaky test.
- **CLI.** Use this only when the reporter can't run inline: results are produced in one CI job and uploaded from another, or you are bulk-importing a backlog of historical \`results.json\` files. The CLI uploads a Playwright JSON report; it does not upload traces.

Inspect the repo before deciding. If tests and upload happen in the same job, use the reporter.

## Reporter path

### 1. Install

Detect the package manager from the lockfile (\`pnpm-lock.yaml\` -> pnpm, \`yarn.lock\` -> yarn, \`bun.lockb\` -> bun, else npm) and install as a dev dependency:

\`\`\`bash
pnpm add -D @kinora/reporter   # or: npm i -D @kinora/reporter
\`\`\`

\`@playwright/test\` (>=1.40) is a peer dependency and is already present in a Playwright project.

### 2. Edit the Playwright config

Find the Playwright config (\`playwright.config.ts\` / \`.js\` / \`.mts\`; in a monorepo there may be more than one, edit the one that runs the suite you want reported). Merge kinora in without clobbering existing settings:

- Add \`['@kinora/reporter', { project: { slug: '<slug>' } }]\` to the \`reporter\` array. If \`reporter\` is a single value or absent, turn it into an array and keep whatever was there (for example the default \`html\` reporter).
- Choose \`<slug>\` from the repo (the \`package.json\` name, kebab-cased) unless the user names one. The slug is the project's stable identity in kinora.
- A trace must be captured or failures upload nothing. If \`use.trace\` is unset, add \`trace: 'on-first-retry'\` (records only when a test retries, so it's cheap). If it is already set to any capturing value, leave it alone. Do not switch anyone to \`'on'\`: that traces every test on every run and is expensive.

Resulting shape (preserve the user's other options):

\`\`\`ts
import { defineConfig } from '@playwright/test'

export default defineConfig({
  reporter: [
    ['html'], // keep existing reporters
    ['@kinora/reporter', { project: { slug: 'web-app' } }],
  ],
  use: { trace: 'on-first-retry' },
})
\`\`\`

### 3. Wire the token

The token comes from the environment, kept out of the config file. Do not write its value anywhere committed. Where it goes depends on where the suite runs, so figure that out (or ask the user) before adding files:

- **CI only** (the common case): add \`KINORA_TOKEN\` to the CI provider's secrets and reference it in the workflow (see below). Nothing else is needed - do not create a \`.env\` or \`.env.example\` the repo doesn't already use.
- **Also run locally**: have the user put the token in an untracked \`.env\` (confirm \`.env\` is gitignored). Only add it to \`.env.example\` if the repo already keeps one.

Local run:

\`\`\`bash
KINORA_TOKEN=<token> npx playwright test
\`\`\`

If \`KINORA_TOKEN\` is missing the reporter logs a warning and skips the upload, so local runs without it still pass.

### 4. Self-host only

If the user self-hosts, also set \`KINORA_URL\` to their server (same places as the token: CI secrets and \`.env\`). On the hosted cloud, do nothing here.

### 5. CI

In the workflow that runs the tests, pass the token via secrets. On GitHub Actions and GitLab CI, git and CI metadata (sha, branch, repo URL, run link) auto-detect from the standard \`GITHUB_*\` / \`CI_*\` vars; pass them explicitly on other providers.

\`\`\`yaml
- run: npx playwright test
  env:
    KINORA_TOKEN: \${{ secrets.KINORA_TOKEN }}
    # self-host only:
    # KINORA_URL: \${{ secrets.KINORA_URL }}
\`\`\`

## CLI path

Use only for cross-job upload or historical backfill (see Step 0). Produce a JSON report, then upload it.

\`\`\`ts
// playwright.config.ts
reporter: [['json', { outputFile: 'results.json' }]]
\`\`\`

\`\`\`bash
# single report
npx @kinora/cli upload results.json --project web-app --token <token>

# bulk import an archive (past-period runs are free and skip alerts)
npx @kinora/cli import ./reports --project web-app --token <token> --concurrency 8
\`\`\`

The CLI also reads \`KINORA_TOKEN\` / \`KINORA_URL\` from the environment; prefer that over \`--token\` in CI. The \`import\` command does not upload traces (a JSON archive has no trace.zip on disk); pass rates, trends, and flaky detection still work.

## Done checklist

- [ ] \`@kinora/reporter\` (or the CLI) is installed as a dev dependency.
- [ ] The reporter line is merged into the Playwright config without dropping existing reporters.
- [ ] A capturing \`trace\` value is set.
- [ ] \`KINORA_TOKEN\` is referenced from the environment, never committed; it lives in CI secrets (and an untracked \`.env\` only if the suite also runs locally).
- [ ] CI passes \`KINORA_TOKEN\` (and \`KINORA_URL\` if self-host) via secrets.
- [ ] You told the user, in your final message, where to paste the token (CI secrets, plus a local \`.env\` if they run locally).

Push a run and it lands in the dashboard at ${app}.
`

  return new Response(body, { headers: { 'Content-Type': 'text/markdown; charset=utf-8' } })
}
