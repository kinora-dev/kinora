export const SITE = {
  name: 'kinora',
  url: 'https://kinora.dev',
  app: 'https://app.kinora.dev',
  login: 'https://app.kinora.dev/login',
  signup: 'https://app.kinora.dev/signup',
  demo: 'https://demo.kinora.dev',
  docs: 'https://docs.kinora.dev',
  // Same origin as the marketing site on purpose: the trace viewer needs a
  // service worker, and the SEO page that ranks for it should keep the visit.
  traceViewer: 'https://kinora.dev/trace/',
  repo: 'https://github.com/Kinora-dev/kinora',
  selfhost: 'https://docs.kinora.dev/self-hosting/',
  download: 'https://github.com/Kinora-dev/kinora/releases/latest',
  tagline: 'Playwright test intelligence',
  description:
    'A dashboard for your Playwright tests, across projects and over time, with an embedded trace viewer. Track pass rates, spot trends, surface flaky tests, and open the full trace inline.',
  cal: 'https://cal.com/joris-gallot',
  email: 'hi@kinora.dev',
} as const

// Deep links into docs.kinora.dev, kept in one place so a docs reorg is a
// single edit here instead of a grep across every section and data file.
export const DOCS = {
  gettingStarted: `${SITE.docs}/getting-started/`,
  reporter: `${SITE.docs}/guides/reporter/`,
  cli: `${SITE.docs}/guides/cli/`,
  mcp: `${SITE.docs}/guides/mcp/`,
  desktop: `${SITE.docs}/guides/desktop/`,
  alerts: `${SITE.docs}/guides/alerts/`,
  prComments: `${SITE.docs}/guides/pr-comments/`,
  api: `${SITE.docs}/reference/api/`,
  environment: `${SITE.docs}/reference/environment/`,
  selfHosting: SITE.selfhost,
  storage: `${SITE.docs}/self-hosting/storage/`,
} as const

export const NAV: { label: string, href: string, event?: string }[] = [
  { label: 'Features', href: '/#features' },
  { label: 'Trace viewer', href: '/#trace' },
  { label: 'Desktop', href: '/#desktop' },
  { label: 'Agents', href: '/#mcp' },
  { label: 'Pricing', href: '/#pricing' },
  { label: 'Setup', href: '/#setup' },
  { label: 'Docs', href: SITE.docs, event: 'docs-nav' },
]
