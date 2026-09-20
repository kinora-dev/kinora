import { DOCS } from '../lib/site'

export interface Faq {
  q: string
  a: string
  // Kept out of `a` on purpose: the answer text is reused verbatim in the
  // FAQPage JSON-LD and in llms.txt, which both want plain prose.
  docs?: { label: string, href: string, event: string }[]
}

export const HOME_FAQS: Faq[] = [
  {
    q: 'What is kinora?',
    a: 'kinora is an open-source dashboard for Playwright test reports. It collects results from every CI run and tracks pass rates, trends, and flaky tests across projects and over time, with the full Playwright trace viewer embedded inline for failures.',
  },
  {
    q: 'How is kinora different from Playwright\'s built-in HTML report?',
    a: 'Playwright\'s HTML report covers a single run on one machine. kinora sits one level up: it ingests every run from CI, keeps history, and lets you compare runs, watch pass-rate trends, and detect flaky tests over time. The trace viewer is the same one you know, embedded directly in the dashboard.',
  },
  {
    q: 'Is kinora free?',
    a: 'Yes. You can self-host the full dashboard and trace viewer for free, forever. The server and dashboard are FSL-1.1-licensed and the trace viewer is MIT. A hosted cloud version is also available, with a free tier (2,500 test results per month) and paid plans from $49/month.',
  },
  {
    q: 'Can I self-host kinora?',
    a: 'Yes. kinora ships a single-origin Docker Compose bundle (Postgres, server, and web in one). Self-hosting is unlimited and needs no account. The client libraries you embed, the reporter and CLI, are MIT-licensed.',
    docs: [{ label: 'Self-hosting guide', href: DOCS.selfHosting, event: 'docs-faq-self-hosting' }],
  },
  {
    q: 'How do I send my Playwright results to kinora?',
    a: 'Two ways: add @kinora/reporter to your playwright.config, or upload results.json with the kinora CLI from CI. Both derive the same test identity, so history stays stable regardless of how a result was uploaded.',
    docs: [
      { label: 'Getting started', href: DOCS.gettingStarted, event: 'docs-faq-getting-started' },
      { label: 'Reporter', href: DOCS.reporter, event: 'docs-faq-reporter' },
      { label: 'CLI', href: DOCS.cli, event: 'docs-faq-cli' },
    ],
  },
  {
    q: 'Does kinora work with my CI provider?',
    a: 'Yes, kinora is CI-agnostic. The ingest API is plain REST authed by an API key, so any CI provider such as GitHub Actions or GitLab CI, or a plain curl command, can push results.',
    docs: [{ label: 'REST API reference', href: DOCS.api, event: 'docs-faq-api' }],
  },
  {
    q: 'Does kinora comment on GitHub pull requests?',
    a: 'Yes. On a pull_request run, the reporter or CLI posts (and keeps updating) a summary comment on the PR: pass/fail counts, tests newly failing versus the base branch, and a link to the run. It uses the CI job\'s own GITHUB_TOKEN, so no credentials are stored in kinora and it works self-host and cloud alike.',
    docs: [{ label: 'PR comments guide', href: DOCS.prComments, event: 'docs-faq-pr-comments' }],
  },
  {
    q: 'Where are my traces and artifacts stored?',
    a: 'trace.zip artifacts are stored on local disk by default, or in any S3-compatible store (AWS, Cloudflare R2, MinIO). When you self-host, everything stays on your own infrastructure.',
    docs: [{ label: 'Artifact storage', href: DOCS.storage, event: 'docs-faq-storage' }],
  },
  {
    q: 'What is the kinora desktop app?',
    a: 'The desktop app is a local Playwright trace viewer that needs no account, plus an account dashboard that signs into your kinora server. It can re-run a failing test locally with your repo\'s own Playwright and open the resulting trace inline.',
    docs: [{ label: 'Desktop guide', href: DOCS.desktop, event: 'docs-faq-desktop' }],
  },
]
