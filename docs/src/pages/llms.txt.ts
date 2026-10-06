import type { APIRoute } from 'astro'
import { hrefFor, NAV } from '../lib/nav'
import { SITE } from '../lib/site'

export const GET: APIRoute = () => {
  const url = SITE.url

  const sections = NAV.map((group) => {
    const items = group.items
      .map(it => `- [${it.label}](${url}${hrefFor(it.slug)})`)
      .join('\n')
    return group.label ? `## ${group.label}\n${items}` : items
  }).join('\n\n')

  const body = `# kinora docs

> Documentation for kinora, the dashboard for Playwright test reports across projects and over time, with an embedded trace viewer. CI runs push their results to kinora; it tracks pass rates, trends, and flaky tests, and opens the full Playwright trace inline for any failure.

${sections}

## Links
- Website: ${SITE.home}
- App (sign up / log in): ${SITE.app}
- Live demo: ${SITE.demo}
- GitHub: ${SITE.repo}
- Full text (every page in one file): ${url}/llms-full.txt

## Key facts
- License: FSL-1.1-MIT. The server, web, and desktop are FSL-1.1 (source-available, converts to MIT after 2 years); the reporter, CLI, core, ui, mcp, and the trace viewer are MIT.
- Ingest: add @kinora/reporter to playwright.config, or upload results.json with the kinora CLI from CI. Both derive the same cross-run test identity, so history stays stable regardless of upload path.
- Alerts: per-project notifications on new failures / regressions via Slack, email, and webhook, with an always / on-failure / on-regression policy.
- PR comments: on a GitHub pull_request run or a GitLab merge request pipeline, the reporter or CLI post a summary comment on the PR/MR (pass/fail, tests newly failing vs the base branch, link to the run). GitHub uses the CI job's GITHUB_TOKEN; GitLab uses a GITLAB_TOKEN CI variable. No credentials are stored in kinora; works self-host and cloud.
- MCP: @kinora/mcp exposes failures, traces, and per-test history to coding agents (Claude Code, Cursor, and others) over stdio.
- Desktop: an Electron app for macOS, Windows, and Linux - a local Playwright trace viewer (no account) plus an account dashboard that can re-run a failing test locally.
- Self-host: one Docker Compose (KINORA_CLOUD=false); every feature, including alerts, is unlimited. Cloud has a free tier (2,500 test results/month, 1 project, 7-day retention) and paid plans from $49/month.
- API: plain REST, API-key (Bearer) auth. POST /api/v1/runs to ingest a run; GET read routes for projects, runs, failures, and per-test history.
`

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
