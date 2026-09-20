import { DOCS, SITE } from '../lib/site'

export type ShotKey = 'overview' | 'test-history' | 'tests' | 'trace-viewer' | 'compare' | 'project'

export interface DocsRef {
  label: string
  href: string
  event: string
}

export interface SolPoint {
  title: string
  body: string
  docs?: DocsRef[]
}

export interface SolFaq {
  q: string
  a: string
  // Kept out of `a`: the answer is reused verbatim in the FAQPage JSON-LD
  // and in llms.txt, which both want plain prose.
  docs?: DocsRef[]
}

export interface SolTool {
  name: string
  desc: string
}

export interface SolCta {
  label: string
  href: string
  event: string
}

export interface Solution {
  slug: string
  eyebrow: string
  h1: string
  title: string
  description: string
  tldr: string
  intro: string
  shot?: ShotKey
  shotAlt?: string
  mcp?: { config: string, tools: SolTool[] }
  // Overrides the default "Get started" hero button when the page has a tool to open.
  cta?: SolCta
  points: SolPoint[]
  faqs: SolFaq[]
  // Rendered as a "Docs" row under the FAQ, so every landing page has at
  // least one route into docs.kinora.dev.
  docs?: DocsRef[]
}

export const SOLUTIONS: Solution[] = [
  {
    slug: 'playwright-report-with-history',
    eyebrow: 'Test history',
    h1: 'A Playwright report with history',
    title: 'Playwright report with history across runs | kinora',
    description:
      'Playwright\'s HTML report shows one run. kinora keeps every run: pass-rate trends, run-over-run comparison, and flaky detection across projects, with the trace viewer embedded.',
    tldr:
      'Playwright\'s HTML report shows one run on one machine. kinora keeps every run, so you get a Playwright report with full history: pass-rate trends, run-over-run comparison, and flaky detection across projects.',
    intro:
      'The built-in HTML report is per-run and disposable, so there is no way to see whether a test has been degrading for weeks or how a project trends release over release. kinora ingests every run from CI and stores it, turning a pile of one-off reports into a persistent history you can search, compare, and trend, without giving up the Playwright trace viewer.',
    shot: 'test-history',
    shotAlt: 'kinora showing a single test\'s pass/fail history across many runs over time',
    points: [
      {
        title: 'Every run, kept',
        body: 'Push each CI run to kinora and it stores the result: forever when you self-host, or for your plan\'s retention window on cloud. No more reports overwritten on the next build.',
      },
      {
        title: 'Trends at a glance',
        body: 'Pass rate over time, per project and per test, so a slow decline is visible long before it becomes a fire drill.',
      },
      {
        title: 'Run-over-run compare',
        body: 'Diff any two runs to see exactly which tests changed status, newly failed, or recovered.',
      },
      {
        title: 'Same trace, still inline',
        body: 'Open the full Playwright trace for any historical failure, embedded directly in the dashboard.',
      },
    ],
    faqs: [
      {
        q: 'How do I add history to my Playwright report?',
        a: 'Playwright\'s built-in HTML report is per-run. Send your results to kinora with @kinora/reporter or the kinora CLI, and it builds a persistent history across every run automatically.',
      },
      {
        q: 'Does it keep traces for old runs?',
        a: 'Yes, subject to your retention window. When you self-host, traces are kept for as long as you keep them on your own storage.',
        docs: [{ label: 'Artifact storage', href: DOCS.storage, event: 'docs-sol-storage-faq' }],
      },
      {
        q: 'Is a Playwright report with history free?',
        a: 'Self-hosting kinora is free forever, and the cloud has a free tier. Both give you cross-run history out of the box.',
      },
    ],
    docs: [
      { label: 'Getting started', href: DOCS.gettingStarted, event: 'docs-sol-history' },
      { label: 'Reporter', href: DOCS.reporter, event: 'docs-sol-history-reporter' },
    ],
  },
  {
    slug: 'playwright-flaky-test-dashboard',
    eyebrow: 'Flaky tests',
    h1: 'A flaky test dashboard for Playwright',
    title: 'Playwright flaky test dashboard - rank every flake | kinora',
    description:
      'See which Playwright tests pass and fail without a code change, ranked by how often they flip, with the full history and the trace one click away. Stop hitting retry.',
    tldr:
      'kinora is a flaky test dashboard for Playwright: it watches every run and surfaces the tests that pass and fail without code changes, so you can find, rank, and fix them instead of hitting retry.',
    intro:
      'Flaky tests hide in per-run retries: the report goes green, the flake is invisible, and trust in the suite erodes. kinora compares each test\'s outcome across your entire run history, so tests that flip between pass and fail are surfaced and ranked, with the full timeline and the trace one click away.',
    shot: 'tests',
    shotAlt: 'kinora test list highlighting flaky tests ranked by how often they change status',
    points: [
      {
        title: 'Flakiness ranked',
        body: 'Tests that flip between pass and fail across runs are surfaced and ranked, not buried inside a single run\'s retries.',
      },
      {
        title: 'History behind every flake',
        body: 'See the full pass/fail timeline for a test to judge how bad a flake really is before you spend time on it.',
      },
      {
        title: 'Straight to the trace',
        body: 'One click from a flaky failure to its full Playwright trace, embedded inline.',
      },
      {
        title: 'Alerts on regressions',
        body: 'Get notified in Slack, email, or webhook the moment a stable test starts failing.',
        docs: [{ label: 'Alerts guide', href: DOCS.alerts, event: 'docs-sol-alerts' }],
      },
    ],
    faqs: [
      {
        q: 'How does kinora detect flaky tests?',
        a: 'It compares each test\'s outcome across your run history. Tests that change status without a code change are flagged as flaky and ranked by how often they flip.',
      },
      {
        q: 'Can I get alerted about new flaky tests?',
        a: 'Yes. Per-project alerts fire on new failures and regressions, delivered via Slack, email, or webhook.',
        docs: [{ label: 'Alerts guide', href: DOCS.alerts, event: 'docs-sol-alerts-faq' }],
      },
      {
        q: 'Do I need to change my tests to use it?',
        a: 'No. Send results with @kinora/reporter or the CLI and flaky detection is automatic; there are no test-code changes.',
      },
    ],
    docs: [
      { label: 'Alerts', href: DOCS.alerts, event: 'docs-sol-flaky-alerts' },
      { label: 'Getting started', href: DOCS.gettingStarted, event: 'docs-sol-flaky' },
    ],
  },
  {
    slug: 'playwright-trace-viewer-online',
    eyebrow: 'Trace viewer',
    h1: 'The Playwright trace viewer, online',
    title: 'Playwright trace viewer online - open trace.zip in the browser',
    description:
      'Open a Playwright trace in your browser: the real trace viewer, with timeline, DOM snapshots, network and console. No trace.zip download, no playwright show-trace.',
    tldr:
      'Drop a trace.zip and it opens right here, in your browser. No install, no account, and the file never leaves your machine.',
    intro:
      'The Playwright trace viewer is normally something you run locally: download trace.zip from CI, then playwright show-trace. kinora runs the real viewer as a web page instead, so a trace opens the moment you pick it, with the full timeline, DOM snapshots, network, console, and source. The zip is read in your browser by a service worker, so nothing is uploaded anywhere. Connect your CI later and the same viewer opens every failure straight from your run history.',
    shot: 'trace-viewer',
    shotAlt: 'the Playwright trace viewer embedded in kinora, showing timeline, snapshot, and network panels',
    cta: {
      label: 'Open a trace',
      href: SITE.traceViewer,
      event: 'open-trace-viewer',
    },
    points: [
      {
        title: 'Nothing to install',
        body: 'Drop a trace.zip on the page and it opens. No show-trace, no download step, no sign-up.',
      },
      {
        title: 'The trace stays on your machine',
        body: 'The zip is read locally in your browser, never uploaded, so traces from a private project stay private.',
      },
      {
        title: 'The real trace viewer',
        body: 'Timeline, DOM snapshots, network, console, and source, vendored straight from Playwright, so everything behaves as you expect.',
      },
      {
        title: 'Then straight from CI',
        body: 'Send your runs to kinora and the same viewer opens on any failure, from any past run, with no artifact dance.',
      },
    ],
    faqs: [
      {
        q: 'Can I open a Playwright trace online without installing anything?',
        a: 'Yes. Drop a trace.zip on the viewer and it opens in your browser, with no install, no account, and nothing to configure.',
      },
      {
        q: 'Is my trace uploaded to kinora?',
        a: 'No. The zip is read locally in your browser by a service worker, the same way the viewer reads a remote trace. It never reaches a kinora server.',
      },
      {
        q: 'Is it the real Playwright trace viewer?',
        a: 'Yes. The trace viewer is vendored from Playwright, so the timeline, snapshots, network, and console tabs behave exactly as you expect.',
      },
      {
        q: 'Can I open traces from CI automatically?',
        a: 'Yes. Send your runs with @kinora/reporter or the CLI, and every failure opens its trace inline in the dashboard, for any run kinora has kept.',
      },
      {
        q: 'Is there a desktop app?',
        a: 'Yes. The kinora desktop app is a standalone Playwright trace viewer that opens traces from your file manager, also without an account.',
      },
    ],
    docs: [
      { label: 'Desktop app', href: DOCS.desktop, event: 'docs-sol-viewer-desktop' },
      { label: 'Getting started', href: DOCS.gettingStarted, event: 'docs-sol-viewer' },
    ],
  },
  {
    slug: 'playwright-mcp-coding-agents',
    eyebrow: 'Coding agents',
    h1: 'Playwright CI failures, in your coding agent',
    title: 'Playwright MCP server for coding agents | kinora',
    description:
      'kinora ships an MCP server so Claude Code, Cursor, or any MCP client pulls your latest Playwright failures, traces, and flaky history straight into the chat, then works the fix.',
    tldr:
      'kinora ships an MCP server. Point Claude Code, Cursor, or any MCP client at it and your agent pulls the failing test, its trace, and flaky history straight into the chat, then works the fix. Local over stdio, against the cloud or your own self-host.',
    intro:
      'Copy-pasting a stack trace into your agent was step one. kinora exposes your CI test data over the Model Context Protocol, so the agent reads the last run\'s failures, opens the Playwright trace, and checks whether a test is a fresh regression or a chronic flake, without you shuttling files around. It runs locally over stdio against kinora cloud or your self-host, scoped to your API token.',
    mcp: {
      config: `{
  "mcpServers": {
    "kinora": {
      "command": "npx",
      "args": ["-y", "@kinora/mcp"],
      "env": { "KINORA_TOKEN": "<token>" }
    }
  }
}`,
      tools: [
        { name: 'list_failures', desc: 'the last run\'s failures, with error and file:line' },
        { name: 'get_trace', desc: 'the Playwright trace for any failing test' },
        { name: 'test_history', desc: 'flaky-vs-regression history per test' },
        { name: 'list_projects', desc: 'every project and its latest run' },
        { name: 'get_run', desc: 'the full report for a single run' },
      ],
    },
    points: [
      {
        title: 'Five tools, zero glue',
        body: 'The agent calls the tools directly over MCP, no scraping and no copy-paste.',
      },
      {
        title: 'Straight into the chat',
        body: 'Point Claude Code, Cursor, or any MCP client at kinora and the failing test, its error and file:line, and the trace land in context.',
      },
      {
        title: 'Regression or flake',
        body: 'test_history gives the agent pass/fail/flaky rates, so it fixes a real regression instead of chasing a chronic flake.',
      },
      {
        title: 'Local, cloud, or self-host',
        body: 'Runs over stdio with your API token, against kinora cloud or your own self-hosted server. Your data stays yours.',
      },
    ],
    faqs: [
      {
        q: 'How do I connect a coding agent to my Playwright tests?',
        a: 'Add the kinora MCP server (@kinora/mcp) to your MCP client with a kinora API token. Claude Code, Cursor, or any MCP client can then pull failures, traces, and history from CI.',
      },
      {
        q: 'Which MCP tools does kinora expose?',
        a: 'Five: list_failures, get_trace, test_history, list_projects and get_run, covering the last run\'s failures with error and file:line, the trace for any failing test, per-test flaky-vs-regression history, every project with its latest run, and the full report for a single run.',
      },
      {
        q: 'Does it work with self-hosted kinora?',
        a: 'Yes. The MCP server runs locally over stdio and points at either kinora cloud or your self-hosted server, authenticated with your API token.',
      },
    ],
    docs: [{ label: 'MCP server', href: DOCS.mcp, event: 'docs-sol-mcp' }],
  },
  {
    slug: 'playwright-report-github-actions',
    eyebrow: 'GitHub Actions',
    h1: 'Playwright reports for GitHub Actions',
    title: 'Playwright test report for GitHub Actions | kinora',
    description:
      'Publish Playwright results from GitHub Actions: every run kept with its commit and branch, a summary comment on the pull request, and traces you open in the browser.',
    tldr:
      'Add the reporter to your workflow and every GitHub Actions run lands in kinora with its commit, branch, and run link. Pull requests get a summary comment, and the trace for any failure opens in the browser.',
    intro:
      'The Actions log tells you a test failed. It does not tell you whether that test has been failing all week, whether this branch made it worse, or what the browser was doing when it broke. Uploading the HTML report as an artifact gets you a zip to download and a local server to start. kinora takes the results straight from the job: every run is kept with its commit and branch, the pull request gets a comment listing what newly failed, and the full Playwright trace opens inline.',
    shot: 'project',
    shotAlt: 'kinora project view listing GitHub Actions runs with pass rate, flaky count, and commit SHA',
    points: [
      {
        title: 'One step in the workflow',
        body: 'Add @kinora/reporter to playwright.config and put KINORA_TOKEN in the job env. No artifact upload, no extra step, no change to your tests.',
      },
      {
        title: 'Commit, branch, and run linked',
        body: 'The commit SHA, branch, base branch, and the Actions run URL are picked up from the job environment, so every run in kinora points back at the workflow that produced it.',
      },
      {
        title: 'A comment on the pull request',
        body: 'On a pull_request run, kinora posts pass/fail counts and the tests newly failing versus the base branch, then edits that same comment on every re-run. It uses the job\'s own GITHUB_TOKEN, so no credentials are stored.',
      },
      {
        title: 'Traces without the artifact dance',
        body: 'No upload-artifact, no download, no local show-trace. Click a red test and the real Playwright trace viewer opens in the dashboard.',
      },
    ],
    faqs: [
      {
        q: 'How do I publish a Playwright report from GitHub Actions?',
        a: 'Add @kinora/reporter to your playwright.config, store a kinora API token as a repository secret, and pass it to the test step as KINORA_TOKEN. The reporter uploads results when the run ends; nothing else in the workflow changes.',
      },
      {
        q: 'Can kinora comment on the pull request?',
        a: 'Yes. On pull_request runs it posts a summary with pass/fail counts and the tests newly failing versus the base branch, and updates that same comment on re-runs. The job needs pull-requests: write permission. Pull requests from forks are skipped, because their GITHUB_TOKEN is read-only.',
      },
      {
        q: 'Does it work with sharded or matrix jobs?',
        a: 'Yes. Merge shards with Playwright\'s merge-reports so the run uploads once as a single report. For matrix legs that share one pull request, give each leg its own PR comment label so they keep separate comments.',
      },
    ],
    docs: [
      { label: 'PR comments', href: DOCS.prComments, event: 'docs-sol-gha-pr' },
      { label: 'REST API', href: DOCS.api, event: 'docs-sol-gha-api' },
    ],
  },
  {
    slug: 'self-hosted-playwright-dashboard',
    eyebrow: 'Self-hosting',
    h1: 'A self-hosted Playwright dashboard',
    title: 'Self-hosted Playwright test dashboard | kinora',
    description:
      'Run kinora on your own infrastructure with one docker compose: dashboard, embedded trace viewer, and Postgres. Free, no seat limits, and traces never leave your disk.',
    tldr:
      'kinora self-hosts with one docker compose: Postgres, the dashboard, and the embedded trace viewer on a single origin. Free forever, every feature unlocked, and your traces stay on your own storage.',
    intro:
      'Test results carry your app\'s screenshots, network traffic, and sometimes production-shaped data, which is why plenty of teams cannot ship them to a vendor. The self-host bundle runs the same dashboard as the cloud on your own box: one docker compose brings up Postgres, the server, and the web container, with the trace viewer served from the same origin.',
    shot: 'overview',
    shotAlt: 'kinora overview showing pass rate and run health across several self-hosted projects',
    points: [
      {
        title: 'One docker compose',
        body: 'Postgres, a one-shot migration, the server, and the web container. Set PUBLIC_URL, AUTH_SECRET, and a database password, then bring it up.',
      },
      {
        title: 'Single origin, no CORS',
        body: 'The web container serves the dashboard and trace viewer and proxies the API to the server, so the session cookie stays host-only and there is nothing cross-origin to configure.',
      },
      {
        title: 'Your traces, your storage',
        body: 'trace.zip artifacts land on a local volume by default, or in any S3-compatible store: AWS, Cloudflare R2, MinIO, or Hetzner.',
        docs: [{ label: 'Artifact storage', href: DOCS.storage, event: 'docs-sol-storage' }],
      },
      {
        title: 'Nothing metered',
        body: 'Self-host runs with billing off: no seat cap, no retention window, no usage limit, and no license key to check in with.',
      },
    ],
    faqs: [
      {
        q: 'Is self-hosting kinora free?',
        a: 'Yes, free forever. The server, dashboard, and desktop app are fair source (FSL-1.1-MIT, which converts to MIT after two years); the reporter, CLI, core, and trace viewer are MIT. There is no license key and no seat cap.',
      },
      {
        q: 'What do I need to run it?',
        a: 'A host with Docker. The bundle brings its own Postgres and keeps traces on a local volume, so a single small VM is enough to start. Point it at an S3-compatible bucket when artifacts outgrow the disk.',
      },
      {
        q: 'Do self-hosted runs lose any features?',
        a: 'No, the opposite. Self-host unlocks everything: unlimited projects and retention, alerts, GitHub PR comments, the MCP server, and the desktop app all work the same as on cloud.',
      },
    ],
    docs: [
      { label: 'Self-hosting', href: DOCS.selfHosting, event: 'docs-sol-selfhost' },
      { label: 'Environment reference', href: DOCS.environment, event: 'docs-sol-selfhost-env' },
    ],
  },
]
