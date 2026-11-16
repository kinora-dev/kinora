import type { APIRoute } from 'astro'
import type { CompRow } from '../data/comparisons'
import { COMPARISONS } from '../data/comparisons'
import { HOME_FAQS, MORE_FAQS } from '../data/faq'
import { SOLUTIONS } from '../data/solutions'
import { SITE } from '../lib/site'

function cell(v: CompRow['kinora']): string {
  if (v === true)
    return 'Yes'
  if (v === false)
    return 'No'
  return v
}

function faqBlock(faqs: { q: string, a: string }[]): string {
  return faqs.map(f => `**${f.q}**\n${f.a}`).join('\n\n')
}

export const GET: APIRoute = () => {
  const url = SITE.url

  const solutions = SOLUTIONS.map((s) => {
    const points = s.points.map(p => `- ${p.title}: ${p.body}`).join('\n')
    return `### ${s.h1}
${url}/${s.slug}

${s.intro}

${points}

${faqBlock(s.faqs)}`
  }).join('\n\n---\n\n')

  const comparisons = COMPARISONS.map((c) => {
    const rows = c.rows.map(r => `- ${r.label}: kinora = ${cell(r.kinora)}; ${c.themShort} = ${cell(r.them)}`).join('\n')
    const chooseKinora = c.chooseKinora.map(i => `- ${i}`).join('\n')
    const chooseThem = c.chooseThem.map(i => `- ${i}`).join('\n')
    return `### kinora vs ${c.themShort}
${url}/vs/${c.slug}

${c.intro}

kinora: ${c.kinoraIs}

${c.themShort}: ${c.themIs}

Feature by feature:
${rows}

Choose kinora when:
${chooseKinora}

${c.chooseThemLabel}:
${chooseThem}

${faqBlock(c.faqs)}`
  }).join('\n\n---\n\n')

  const body = `# kinora - full content

> kinora is an open-source dashboard for Playwright test reports across projects and over time, with an embedded trace viewer. CI runs push their results to kinora; it tracks pass rates, trends, and flaky tests, and opens the full Playwright trace inline for any failure.

Playwright ships a great HTML report for a single run on one machine. kinora sits one level up: it ingests every run from CI, keeps history, and lets you compare runs, watch pass-rate trends, and surface flaky tests over time. The Playwright trace viewer is embedded directly in the dashboard, so a red test is one click from its full trace.

kinora runs two ways: self-host the full dashboard and trace viewer for free (FSL-1.1 license, single-origin Docker Compose bundle, no account), or use the hosted cloud (free tier plus paid plans). It is CI-agnostic: results are pushed either through the @kinora/reporter or the kinora CLI, over a plain REST ingest API authed by an API key, so any CI provider or a curl command works.

## Links
- Home: ${url}
- Live demo: ${SITE.demo}
- App (sign up / log in): ${SITE.app}
- GitHub: ${SITE.repo}
- Docs: ${SITE.docs}
- Blog: ${url}/blog
- Self-host guide: ${SITE.selfhost}
- Desktop app: ${SITE.download}

## Product FAQ

${faqBlock([...HOME_FAQS, ...MORE_FAQS])}

## Use cases

${solutions}

## Comparisons

${comparisons}

## Key facts
- License: FSL-1.1-MIT. Server, web, and desktop are FSL-1.1 (source-available, converts to MIT after 2 years); the embeddable libraries (reporter, CLI, core, ui) and the trace viewer are MIT.
- Ingest: add @kinora/reporter to playwright.config, or upload results.json with the kinora CLI from CI. Both derive the same cross-run test identity, so history stays stable regardless of upload path.
- Artifacts: trace.zip files are stored on local disk by default, or in any S3-compatible store (AWS, Cloudflare R2, MinIO, Hetzner). Self-hosted, everything stays on your own infrastructure.
- Alerts: per-project notifications on new failures and regressions via Slack, email, and webhook.
- PR comments: on a GitHub pull_request run or a GitLab merge request pipeline, the reporter/CLI post a summary comment on the PR/MR (pass/fail, tests newly failing vs the base branch, link to the run). GitHub uses the CI job's GITHUB_TOKEN; GitLab uses a GITLAB_TOKEN CI variable. No credentials are stored in kinora; works self-host and cloud.
- PR commit status: with prStatus (reporter) or --pr-status (CLI), kinora sets a kinora / <project> commit status on the GitHub PR or GitLab MR pipeline, red only when a test fails on the PR that passed on the base branch (already-failing and flaky tests leave it green), so merges can be gated on regressions only. Docs: ${SITE.docs}/guides/pr-comments/#commit-status
- Balanced shards: kinora shard splits a Playwright suite into shards by each test's median duration over the latest runs (Playwright's --shard splits by test count) and writes one test list per shard for --test-list. Docs: ${SITE.docs}/guides/cli/#balanced-shards
- Quarantine in CI: tests quarantined in the dashboard mute their alerts; kinora quarantine writes them as a Playwright test list, so the blocking CI job skips them (--test-list-invert) while a non-blocking job keeps running them and their history. Docs: ${SITE.docs}/guides/flaky-tests/#quarantine-in-ci
- Desktop: an Electron app that is a local Playwright trace viewer (no account) plus an account dashboard; it can re-run a failing test locally with your repo's own Playwright and open the resulting trace inline.
- Pricing: self-host is free forever. Cloud has a free tier (2,500 test results/month, 1 project, 7-day retention) and paid plans from $49/month billed by test results, with unlimited seats on every plan.
`

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
