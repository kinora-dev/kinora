export interface CompRow {
  label: string
  kinora: boolean | string
  them: boolean | string
}

export interface CompFaq {
  q: string
  a: string
}

export interface Comparison {
  slug: string
  them: string
  themShort: string
  title: string
  description: string
  tldr: string
  kinoraIs: string
  themIs: string
  intro: string
  rows: CompRow[]
  chooseKinora: string[]
  chooseThemLabel: string
  chooseThem: string[]
  faqs: CompFaq[]
}

type Cell = boolean | string

// Canonical kinora capability + default label, defined once. A comparison references a feature by id
// and supplies only the competitor's value; label/kinora can be overridden per comparison for framing
const FEATURES = {
  traceViewer: { label: 'Embedded Playwright trace viewer', kinora: true },
  flaky: { label: 'Flaky detection', kinora: true },
  history: { label: 'Cross-run history & trends', kinora: true },
  alerts: { label: 'Alerts (Slack / email / webhook)', kinora: true },
  prComment: { label: 'PR comment on CI runs (GitHub, GitLab)', kinora: true },
  mcp: { label: 'MCP server for coding agents', kinora: true },
  desktop: { label: 'Desktop trace-viewer app', kinora: true },
  selfHost: { label: 'Self-hosting', kinora: true },
  license: { label: 'Open source', kinora: 'Fair source (FSL-1.1)' },
} satisfies Record<string, { label: string, kinora: Cell }>

type FeatureId = keyof typeof FEATURES

// A row either references a shared feature (label/kinora from the registry, overridable) or is fully inline.
interface SourceRow {
  feature?: FeatureId
  label?: string
  kinora?: Cell
  them: Cell
}

interface ComparisonSource extends Omit<Comparison, 'rows'> {
  rows: SourceRow[]
}

function resolveRow(r: SourceRow): CompRow {
  const f = r.feature ? FEATURES[r.feature] : undefined
  const label = r.label ?? f?.label
  const kinora = r.kinora ?? f?.kinora
  if (label === undefined || kinora === undefined)
    throw new Error(`comparison row needs a feature or an explicit label+kinora: ${JSON.stringify(r)}`)
  return { label, kinora, them: r.them }
}

const KINORA_IS
  = 'kinora is an open-source dashboard that ingests every Playwright run from CI and tracks pass rates, trends, and flaky tests across projects and over time, with the full Playwright trace viewer embedded inline.'

const SOURCES: ComparisonSource[] = [
  {
    slug: 'playwright-html-report',
    them: 'Playwright\'s HTML report',
    themShort: 'Playwright HTML report',
    title: 'kinora vs Playwright HTML report: history & trends',
    description:
      'Playwright\'s HTML report shows a single run. kinora keeps every run: cross-project history, pass-rate trends, and flaky detection, with the same trace viewer embedded.',
    tldr:
      'Playwright\'s HTML report shows you one run on one machine. kinora shows you every run: history, trends, and flaky tests across projects, with the same trace viewer embedded inline.',
    kinoraIs: KINORA_IS,
    themIs:
      'Playwright\'s HTML report is the built-in reporter that renders a single test run as a static HTML page, with the trace viewer reachable from each failed test.',
    intro:
      'The HTML report is excellent for the run in front of you. It does not persist across runs, merge shards and projects into one view, or tell you a test has been flaky for three weeks. kinora sits one level up and keeps that history, while embedding the very same trace viewer so you never lose the debugging experience.',
    rows: [
      { label: 'Single-run report', kinora: true, them: true },
      { feature: 'traceViewer', them: true },
      { feature: 'history', label: 'History across runs', them: false },
      { label: 'Pass-rate trends over time', kinora: true, them: false },
      { feature: 'flaky', kinora: 'Across run history', them: 'Per-run retries only' },
      { label: 'Multiple repos/suites over time', kinora: true, them: false },
      { label: 'Runs from all CI shards merged', kinora: 'Automatic on ingest', them: 'Via blob + merge-reports' },
      { feature: 'alerts', label: 'Alerts on new failures / regressions', kinora: 'Slack, email, webhook', them: false },
      { feature: 'prComment', them: false },
      { feature: 'mcp', them: false },
      { label: 'Setup', kinora: 'Reporter or CLI', them: 'Built in' },
      { label: 'Cost', kinora: 'Free self-host / free cloud tier', them: 'Free (built in)' },
      { label: 'Hosting', kinora: 'Self-host or cloud', them: 'Local static files' },
    ],
    chooseKinora: [
      'You run tests in CI regularly and want history, trends, and flaky tracking across runs and projects.',
      'You want alerts on new failures or regressions.',
      'You want a shareable dashboard without giving up the Playwright trace viewer.',
      'Your coding agent (Claude Code, Cursor, any MCP client) pulls failing tests, traces, and flaky history from CI over MCP.',
    ],
    chooseThemLabel: 'Stick with the HTML report when',
    chooseThem: [
      'You only need the latest run on your own machine.',
      'You don\'t need history, trends, or a server.',
      'You want the absolute simplest setup, with nothing to host.',
    ],
    faqs: [
      {
        q: 'Does kinora replace Playwright\'s HTML report?',
        a: 'No, it complements it. kinora ingests the same run data and embeds the same Playwright trace viewer, then adds cross-run history, trends, and flaky detection that a single-run HTML report can\'t provide.',
      },
      {
        q: 'Can Playwright\'s HTML report show history across runs?',
        a: 'Not on its own. Each report represents one run on one machine. kinora keeps every run so you can compare them and track pass-rate trends over time.',
      },
      {
        q: 'Do I still get the trace viewer with kinora?',
        a: 'Yes. The full Playwright trace viewer is embedded in the dashboard and opens inline on any failure, so debugging is exactly what you\'re used to.',
      },
    ],
  },
  {
    slug: 'currents',
    them: 'Currents',
    themShort: 'Currents',
    title: 'kinora vs Currents: open-source, self-hostable alternative',
    description:
      'Currents is a cloud-only paid Playwright dashboard. kinora is the open-source, self-hostable alternative: free tier, embedded trace viewer, own your data.',
    tldr:
      'Currents is a cloud-only paid dashboard that also orchestrates your test runs. kinora is open source, self-hostable for free with a free cloud tier, and focuses on the reporting dashboard and embedded trace viewer.',
    kinoraIs: KINORA_IS,
    themIs:
      'Currents is a cloud-only dashboard and test orchestrator for Playwright that parallelizes runs across CI machines and reports the results.',
    intro:
      'Both give you Playwright run history, flaky detection, and traces in the cloud. The differences: Currents is cloud-only with no free tier and adds test orchestration and parallelization; kinora is open source, self-hostable free forever, has a free cloud tier and a desktop app, and stays focused on reporting rather than running your tests.',
    rows: [
      { feature: 'history', label: 'Run history & trends', them: true },
      { feature: 'flaky', them: true },
      { feature: 'traceViewer', label: 'Playwright traces in the dashboard', them: true },
      { feature: 'alerts', them: true },
      { feature: 'prComment', them: true },
      { label: 'Test orchestration / parallelization', kinora: false, them: true },
      { label: 'Flaky quarantine', kinora: false, them: true },
      { feature: 'license', them: false },
      { feature: 'selfHost', them: false },
      { label: 'Free tier', kinora: '2,500 results / mo', them: false },
      { label: 'Entry price', kinora: '$0 self-host / $49 Team', them: '$49 / mo (10k results)' },
      { feature: 'desktop', them: false },
      { feature: 'mcp', them: true },
      { label: 'Data ownership', kinora: 'Yours (self-host) or kinora cloud', them: 'Their cloud' },
    ],
    chooseKinora: [
      'You want to self-host for free or keep test data on your own infrastructure.',
      'You want an open-source tool and a free cloud tier.',
      'You run tests with Playwright\'s own sharding and just need the reporting dashboard, plus a desktop trace viewer.',
      'Your coding agent (Claude Code, Cursor, any MCP client) pulls failing tests, traces, and flaky history from CI over MCP.',
    ],
    chooseThemLabel: 'Choose Currents when',
    chooseThem: [
      'You want managed test orchestration and parallelization in the same tool.',
      'You want built-in flaky quarantine.',
      'Cloud-only with no self-host is fine for you.',
    ],
    faqs: [
      {
        q: 'Is kinora a free alternative to Currents?',
        a: 'Yes. kinora is open source and self-hostable for free, and its cloud has a free tier, whereas Currents is cloud-only with paid plans from $49/month.',
      },
      {
        q: 'Does kinora orchestrate or parallelize tests like Currents?',
        a: 'No. kinora focuses on the reporting dashboard and trace viewer; you keep running tests with Playwright\'s own sharding in CI. Currents additionally orchestrates test execution.',
      },
      {
        q: 'Can I self-host kinora instead of using a cloud?',
        a: 'Yes, with a single Docker Compose bundle, unlimited and free. Currents does not offer self-hosting.',
      },
    ],
  },
  {
    slug: 'allure-report',
    them: 'Allure Report',
    themShort: 'Allure Report',
    title: 'kinora vs Allure Report: Playwright-native dashboard',
    description:
      'Allure Report generates a static per-run report for 50+ frameworks. kinora is a persistent, Playwright-native dashboard with cross-run history and the embedded Playwright trace viewer.',
    tldr:
      'Allure Report generates a portable static report per run for 50+ frameworks. kinora is a persistent, Playwright-native dashboard that keeps history across runs and embeds the Playwright trace viewer, with no CI history plumbing.',
    kinoraIs: KINORA_IS,
    themIs:
      'Allure Report is an open-source, language-agnostic tool that generates a static HTML report from a single test run.',
    intro:
      'Allure Report is a great multi-language static report generator. But it\'s disposable: history across runs means carrying an Allure history folder between CI jobs, and persistent analytics really means the separate commercial Allure TestOps. kinora is a running dashboard: every run is stored, trends and flaky detection work out of the box, and the native Playwright trace viewer is embedded. Allure is framework-agnostic; kinora is Playwright-focused.',
    rows: [
      { feature: 'license', kinora: 'Fair source (FSL-1.1); MIT client libs', them: 'Apache-2.0' },
      { label: 'Frameworks', kinora: 'Playwright', them: '50+ languages / frameworks' },
      { feature: 'history', label: 'Persistent cross-run history', kinora: 'Built in', them: 'Manual history folder' },
      { label: 'Trends & analytics dashboard', kinora: true, them: 'In-report trends; persistent dashboard needs TestOps' },
      { feature: 'flaky', kinora: 'Across run history', them: 'Per-run categorization' },
      { feature: 'traceViewer', them: false },
      { label: 'Runs as a server / live dashboard', kinora: true, them: 'No (static HTML)' },
      { feature: 'alerts', label: 'Alerts on regressions', them: false },
      { feature: 'prComment', them: false },
      { feature: 'mcp', them: 'Allure TestOps (paid)' },
      { label: 'Hosted cloud option', kinora: 'kinora cloud (free tier + paid)', them: 'Allure TestOps (separate paid)' },
      { feature: 'selfHost', label: 'Self-host', kinora: 'Docker Compose', them: 'Static files, host anywhere' },
    ],
    chooseKinora: [
      'You\'re Playwright-first and want a live dashboard with real cross-run history and trends.',
      'You want flaky tracking, regression alerts, and the embedded Playwright trace viewer.',
      'You don\'t want to stitch history together in CI or buy Allure TestOps.',
      'Your coding agent (Claude Code, Cursor, any MCP client) pulls failing tests, traces, and flaky history from CI over MCP.',
    ],
    chooseThemLabel: 'Choose Allure Report when',
    chooseThem: [
      'You test across many languages and frameworks, not just Playwright.',
      'You want a portable static report you can archive and open anywhere.',
      'You don\'t want to run a server at all.',
    ],
    faqs: [
      {
        q: 'Is kinora an alternative to Allure Report?',
        a: 'For Playwright teams, yes. Allure Report generates a static per-run report across many frameworks; kinora is a persistent Playwright-native dashboard with cross-run history and the embedded trace viewer.',
      },
      {
        q: 'Does Allure Report keep history across runs?',
        a: 'Not on its own. You carry an Allure history folder between CI runs, and full persistence is Allure TestOps, a separate commercial product. kinora stores every run automatically.',
      },
      {
        q: 'Does kinora support non-Playwright frameworks?',
        a: 'No. kinora is Playwright-focused. If you need many languages or frameworks, Allure is the broader tool.',
      },
    ],
  },
  {
    slug: 'reportportal',
    them: 'ReportPortal',
    themShort: 'ReportPortal',
    title: 'kinora vs ReportPortal: lightweight Playwright reporting',
    description:
      'ReportPortal is a framework-agnostic reporting platform with ML failure analysis and a heavier stack. kinora is Playwright-native, lightweight to self-host, with an embedded trace viewer and transparent pricing.',
    tldr:
      'ReportPortal is a framework-agnostic reporting platform with ML failure analysis and a heavier stack. kinora is Playwright-native, lightweight to self-host, with an embedded Playwright trace viewer and transparent pricing.',
    kinoraIs: KINORA_IS,
    themIs:
      'ReportPortal is an open-source, framework-agnostic test reporting platform with ML-based failure auto-analysis, self-hostable or available as a managed SaaS.',
    intro:
      'Both are open source and self-hostable. ReportPortal is broad and enterprise-oriented: many languages, ML auto-analysis of failures, a heavier infrastructure footprint, and quote-based SaaS. kinora is narrow by design: Playwright-native, a single-origin Docker Compose install (Postgres, server, web), the embedded Playwright trace viewer, a desktop app, and simple public pricing.',
    rows: [
      { feature: 'license', label: 'Open source & self-host', kinora: 'Fair source (FSL-1.1); self-host', them: 'Apache-2.0; self-host' },
      { label: 'Frameworks', kinora: 'Playwright', them: 'Many languages / frameworks' },
      { feature: 'traceViewer', them: false },
      { label: 'ML failure auto-analysis', kinora: false, them: true },
      { feature: 'history', them: true },
      { feature: 'flaky', them: true },
      { label: 'Self-host footprint', kinora: 'Single Docker Compose', them: 'Heavier, multiple services' },
      { feature: 'alerts', them: true },
      { feature: 'prComment', them: false },
      { label: 'Hosted cloud pricing', kinora: 'Free tier + plans from $49', them: 'SaaS, quote-based' },
      { feature: 'desktop', them: false },
      { feature: 'mcp', them: true },
    ],
    chooseKinora: [
      'You\'re Playwright-first and want the embedded Playwright trace viewer.',
      'You want a lightweight self-host and transparent pricing with a free tier.',
      'You want a desktop trace-viewer app alongside the dashboard.',
      'Your coding agent (Claude Code, Cursor, any MCP client) pulls failing tests, traces, and flaky history from CI over MCP.',
    ],
    chooseThemLabel: 'Choose ReportPortal when',
    chooseThem: [
      'You need one platform across many languages and frameworks.',
      'You want ML-based failure auto-analysis.',
      'You already run enterprise infra and want managed SaaS with a quote.',
    ],
    faqs: [
      {
        q: 'kinora vs ReportPortal, which is better for Playwright?',
        a: 'If your stack is Playwright-first, kinora is purpose-built: a native trace viewer, lightweight self-host, and simple pricing. ReportPortal is better if you need many frameworks or ML failure analysis.',
      },
      {
        q: 'Is ReportPortal heavier to self-host than kinora?',
        a: 'Generally yes. ReportPortal runs several services; kinora ships a single-origin Docker Compose bundle with Postgres, server, and web.',
      },
      {
        q: 'Does ReportPortal have an embedded Playwright trace viewer?',
        a: 'No. kinora embeds the full Playwright trace viewer; ReportPortal shows logs, attachments, and its own analytics.',
      },
    ],
  },
]

export const COMPARISONS: Comparison[] = SOURCES.map(s => ({ ...s, rows: s.rows.map(resolveRow) }))
