import type { APIRoute } from 'astro'
import { COMPARISONS } from '../data/comparisons'
import { SOLUTIONS } from '../data/solutions'
import { SITE } from '../lib/site'

export const GET: APIRoute = () => {
  const url = SITE.url

  const useCases = SOLUTIONS.map(
    s => `- [${s.h1}](${url}/${s.slug}): ${s.tldr}`,
  ).join('\n')

  const comparisons = COMPARISONS.map(
    c => `- [kinora vs ${c.themShort}](${url}/vs/${c.slug}): ${c.tldr}`,
  ).join('\n')

  const body = `# kinora

> kinora is an open-source dashboard for Playwright, Vitest browser-mode and Storybook test reports across projects and over time, with an embedded trace viewer. CI runs push their results to kinora; it tracks pass rates, trends, flaky and broken tests, and accessibility violations, and opens the full Playwright trace inline for any failure.

Playwright ships a great HTML report for a single run on one machine. kinora sits one level up: it ingests every run from CI, keeps history, and lets you compare runs, watch pass-rate trends, and surface flaky tests over time. The Playwright trace viewer is embedded directly in the dashboard, so a red test is one click from its full trace.

kinora runs two ways: self-host the full dashboard and trace viewer for free (FSL-1.1 license, single-origin Docker Compose bundle, no account), or use the hosted cloud (free tier plus paid plans). It is CI-agnostic: results are pushed either through the @kinora/reporter or the kinora CLI, over a plain REST ingest API authed by an API key, so any CI provider or a curl command works.

## Links
- [Home](${url}): product overview, features, pricing, setup
- [Live demo](${SITE.demo}): the dashboard with seeded data
- [App](${SITE.app}): sign up / log in to the cloud
- [GitHub](${SITE.repo}): source code, issues, releases
- [Docs](${SITE.docs}): guides, reference, and self-hosting
- [Blog](${url}/blog): articles about Playwright reporting, flaky tests, traces, CI debugging, and building Kinora
- [Self-host guide](${SITE.selfhost}): Docker Compose bundle
- [Desktop app](${SITE.download}): local trace viewer + account dashboard
- [Agent setup](${url}/llms/setup.md): paste-and-go reporting setup (Playwright, Vitest, Storybook) for coding agents
- [Full text](${url}/llms-full.txt): every use case, comparison, and FAQ in one file

## Use cases
${useCases}

## Comparisons
- [All comparisons](${url}/vs): how kinora compares to the other Playwright reporting tools
${comparisons}

## Key facts
- License: FSL-1.1-MIT. Server, web, and desktop are FSL-1.1 (source-available, converts to MIT after 2 years); the embeddable libraries (reporter, CLI, core, ui) and the trace viewer are MIT.
- Ingest: add @kinora/reporter to playwright.config, or upload results.json with the kinora CLI from CI. Both derive the same cross-run test identity, so history stays stable regardless of upload path.
- Vitest and Storybook: add @kinora/vitest-reporter to vitest.config. It uploads browser-mode and Storybook tests (Node unit tests only with include: 'all'), their Playwright traces and screenshot comparisons, and maps each Storybook story to the Components page.
- Flaky and broken tests: read from the last 20 runs of each test. Flaky = passed and failed on the same commit, needed a retry to pass, or flipped between pass and fail at least 3 times, so it works for suites that run without retries. Broken = fails and keeps failing; kinora names the run and commit where it started. Docs: ${SITE.docs}/guides/flaky-tests/
- Environment incidents: a run where nearly every test failed because the app under test was down (most failures could not reach a Playwright project's baseURL, or the browser crashed) is flagged as an environment incident and kept out of test histories, flaky scores, regression baselines, alerts and PR comment regressions; it can also be marked or cleared by hand. The check-base-url global setup of @kinora/reporter stops a run before any test when a baseURL does not answer. Docs: ${SITE.docs}/guides/environment-incidents/
- Analytics: per project, the share of passed, flaky and failed results over the last 30 days (per day) or 90 days (per week), filterable by branch.
- Accessibility: kinora records axe scans. Playwright: attach the scan to the test as JSON (testInfo.attach), or call scanA11y(page) from @kinora/reporter/a11y, which runs @axe-core/playwright and attaches the result; asserting on the violations fails the test, not asserting keeps them as warnings. Storybook: the a11y addon's check is uploaded by @kinora/vitest-reporter. The dashboard lists violations by impact (critical, serious, moderate, minor) and ranks test files and components by them. Docs: ${SITE.docs}/guides/reporter/#accessibility
- Artifacts: trace.zip files are stored on local disk by default, or in any S3-compatible store (AWS, Cloudflare R2, MinIO, Hetzner). Self-hosted, everything stays on your own infrastructure.
- Alerts: per-project notifications on new failures and regressions via Slack, email, and webhook.
- PR comments: on a GitHub pull_request run or a GitLab merge request pipeline, the reporter/CLI post a summary comment on the PR/MR (pass/fail, tests newly failing vs the base branch, link to the run). GitHub uses the CI job's GITHUB_TOKEN; GitLab uses a GITLAB_TOKEN CI variable. No credentials are stored in kinora; works self-host and cloud.
- Desktop: an Electron app that is a local Playwright trace viewer (no account) plus an account dashboard; it can re-run a failing test locally with your repo's own Playwright and open the resulting trace inline.
- Pricing: self-host is free forever. Cloud has a free tier (2,500 test results/month, 1 project, 7-day retention) and paid plans from $49/month billed by test results, with unlimited seats on every plan.
`

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
