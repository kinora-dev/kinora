import type { Counts, NormTest } from '@kinora/core'
import type { Buffer } from 'node:buffer'
import type { LoadedDemoTrace } from './demo-traces'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { countsByTagFrom, makeTestKey } from '@kinora/core'
import { eq } from 'drizzle-orm'
import { db } from '../src/db'
import { apikey, artifact, member, project, run, test, user as userTable } from '../src/db/schemas/index'
import { DEMO_PASSWORD } from '../src/demo/owner'
import { auth } from '../src/lib/auth'
import { env } from '../src/lib/env'
import { logger } from '../src/lib/logger'
import { storage } from '../src/lib/storage'
import { loadDemoTraces } from './demo-traces'

// Curated, DETERMINISTIC marketing data: same output every reseed so screenshots
// stay reproducible. Separate account from the dev demo seed (scripts/seed.ts).
const EMAIL = 'market@kinora.dev'
// The demo auto-session signs in with this; shared so the two never drift apart.
const PASSWORD = DEMO_PASSWORD
const NAME = 'Kinora'

const RUNS = 30
const DAY = 86_400_000
const LATEST = RUNS - 1

// Deterministic PRNG so durations/jitter/shas never move between reseeds.
function mulberry32(seed: number): () => number {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(0xC0FFEE)
const jitter = (n: number): number => Math.floor(rng() * n)

type Status = NormTest['status']
type Profile
  = | 'solid' | 'mostlyGreen' | 'flakyHistory' | 'chronicFlaky' | 'flakyCluster'
    | 'degrading' | 'outage' | 'recovering' | 'intermittent' | 'chronicFail'
    | 'newlyFlaky' | 'newlyBroken' | 'newlyFailing' | 'fixed' | 'fixmeSkip'

// Status sequence per profile across run ordinals (0 = oldest, LATEST = newest).
// Events are spread across the timeline (not just the tail) so per-run pass rates
// vary -> moving trend lines + multi-colored sparklines. recent window = 25..29.
function statusAt(profile: Profile, i: number): Status {
  switch (profile) {
    case 'solid':
      return 'expected'
    case 'mostlyGreen':
      return i === 6 || i === 17 ? 'flaky' : 'expected'
    case 'flakyHistory':
      return i % 7 === 3 ? 'flaky' : 'expected'
    case 'chronicFlaky': // regular amber dots throughout
      return i % 5 === 3 ? 'flaky' : 'expected'
    case 'flakyCluster': // bursts of flakiness
      return [7, 8, 9, 20, 21].includes(i) ? 'flaky' : 'expected'
    case 'degrading': // healthy, then unravels in the recent window
      return i < 22 ? 'expected' : i % 2 === 0 ? 'unexpected' : 'flaky'
    case 'outage': // a multi-run outage mid-history, then recovers
      return i >= 11 && i <= 13 ? 'unexpected' : i === 14 ? 'flaky' : 'expected'
    case 'recovering': // rough early, green ever since (upward trend)
      return i < 7 ? (i % 2 === 0 ? 'unexpected' : 'flaky') : 'expected'
    case 'intermittent': // scattered red + amber
      return [4, 15, 26].includes(i) ? 'unexpected' : [9, 21].includes(i) ? 'flaky' : 'expected'
    case 'chronicFail': // recurring failures + flakes
      return i % 7 === 5 ? 'unexpected' : i % 7 === 2 ? 'flaky' : 'expected'
    case 'newlyFlaky':
      return i === LATEST ? 'flaky' : 'expected'
    case 'newlyBroken':
      return i >= LATEST - 1 ? 'unexpected' : 'expected'
    // Compare(run-29 -> run-30) story: pass->fail (newly failing) and fail->pass (fixed).
    case 'newlyFailing':
      return i === LATEST ? 'unexpected' : 'expected'
    case 'fixed':
      return i === LATEST - 1 ? 'unexpected' : 'expected'
    case 'fixmeSkip':
      return 'skipped'
  }
}

interface TestDef {
  file: string
  title: string
  profile: Profile
  tags?: string[]
}

interface ProjectDef {
  slug: string
  name: string
  tests: TestDef[]
}

const PROJECTS: ProjectDef[] = [
  {
    // Healthy with real flakiness + one test that just started flaking -> FLAKY badge.
    slug: 'web-app',
    name: 'Web App',
    tests: [
      { file: 'tests/auth.spec.ts', title: 'logs in with valid credentials', profile: 'solid', tags: ['@smoke', '@critical'] },
      { file: 'tests/auth.spec.ts', title: 'rejects a wrong password', profile: 'mostlyGreen', tags: ['@smoke'] },
      { file: 'tests/checkout.spec.ts', title: 'adds an item to the cart', profile: 'chronicFlaky', tags: ['@smoke'] },
      { file: 'tests/checkout.spec.ts', title: 'completes a purchase', profile: 'flakyCluster', tags: ['@smoke', '@critical'] },
      { file: 'tests/checkout.spec.ts', title: 'applies a discount code', profile: 'recovering' },
      { file: 'tests/search.spec.ts', title: 'returns relevant results', profile: 'newlyFlaky', tags: ['@critical'] },
      { file: 'tests/search.spec.ts', title: 'handles an empty query', profile: 'solid' },
      { file: 'tests/dashboard.spec.ts', title: 'renders widgets', profile: 'flakyHistory' },
    ],
  },
  {
    // A regression + a past outage -> FAILING badge, diverse errors, real traces.
    slug: 'checkout-api',
    name: 'Checkout API',
    tests: [
      { file: 'tests/health.spec.ts', title: 'responds 200 on /healthz', profile: 'solid', tags: ['@smoke'] },
      { file: 'tests/payments.spec.ts', title: 'charges a card', profile: 'mostlyGreen', tags: ['@critical'] },
      { file: 'tests/payments.spec.ts', title: 'refunds an order', profile: 'newlyBroken', tags: ['@critical'] },
      { file: 'tests/payments.spec.ts', title: 'splits a payment', profile: 'outage', tags: ['@critical'] },
      { file: 'tests/webhooks.spec.ts', title: 'delivers order.paid', profile: 'intermittent' },
      { file: 'tests/auth.spec.ts', title: 'rejects an expired token', profile: 'fixed', tags: ['@smoke'] },
      { file: 'tests/rate-limit.spec.ts', title: 'throttles past the quota', profile: 'newlyFailing' },
    ],
  },
  {
    // Stable -> PASSING badge, light flakiness + an annotated skip (shows annotations).
    slug: 'marketing-site',
    name: 'Marketing Site',
    tests: [
      { file: 'tests/home.spec.ts', title: 'renders the hero', profile: 'solid', tags: ['@smoke'] },
      { file: 'tests/home.spec.ts', title: 'newsletter signup works', profile: 'mostlyGreen' },
      { file: 'tests/pricing.spec.ts', title: 'toggles annual billing', profile: 'chronicFlaky' },
      { file: 'tests/blog.spec.ts', title: 'lists recent posts', profile: 'fixmeSkip' },
      { file: 'tests/seo.spec.ts', title: 'has correct meta tags', profile: 'recovering', tags: ['@smoke'] },
      { file: 'tests/contact.spec.ts', title: 'submits the form', profile: 'solid' },
    ],
  },
  {
    // Flaky-prone suite -> FLAKY badge, lots of amber across the history.
    slug: 'mobile-app',
    name: 'Mobile App',
    tests: [
      { file: 'tests/onboarding.spec.ts', title: 'completes the welcome flow', profile: 'flakyCluster', tags: ['@smoke'] },
      { file: 'tests/onboarding.spec.ts', title: 'requests notification permission', profile: 'chronicFlaky' },
      { file: 'tests/feed.spec.ts', title: 'pulls to refresh', profile: 'mostlyGreen', tags: ['@critical'] },
      { file: 'tests/feed.spec.ts', title: 'loads the next page', profile: 'intermittent' },
      { file: 'tests/profile.spec.ts', title: 'uploads an avatar', profile: 'newlyFlaky' },
      { file: 'tests/profile.spec.ts', title: 'edits the bio', profile: 'solid' },
      { file: 'tests/push.spec.ts', title: 'opens a deep link', profile: 'recovering' },
      { file: 'tests/offline.spec.ts', title: 'queues writes offline', profile: 'flakyHistory', tags: ['@critical'] },
    ],
  },
  {
    // Recurring failures + a recent regression -> FAILING badge, the reddest history.
    slug: 'api-gateway',
    name: 'API Gateway',
    tests: [
      { file: 'tests/routing.spec.ts', title: 'routes to the right service', profile: 'solid', tags: ['@smoke'] },
      { file: 'tests/auth.spec.ts', title: 'validates the JWT', profile: 'mostlyGreen', tags: ['@critical'] },
      { file: 'tests/ratelimit.spec.ts', title: 'returns 429 over quota', profile: 'chronicFail', tags: ['@critical'] },
      { file: 'tests/proxy.spec.ts', title: 'streams a large response', profile: 'degrading' },
      { file: 'tests/proxy.spec.ts', title: 'retries on upstream 503', profile: 'newlyBroken', tags: ['@critical'] },
      { file: 'tests/cors.spec.ts', title: 'allows preflight requests', profile: 'recovering' },
      { file: 'tests/metrics.spec.ts', title: 'exposes /metrics', profile: 'solid' },
    ],
  },
  {
    // Stable internal tool -> PASSING badge, occasional flakiness.
    slug: 'admin-dashboard',
    name: 'Admin Dashboard',
    tests: [
      { file: 'tests/users.spec.ts', title: 'lists and filters users', profile: 'solid', tags: ['@smoke'] },
      { file: 'tests/users.spec.ts', title: 'invites a teammate', profile: 'mostlyGreen' },
      { file: 'tests/billing.spec.ts', title: 'shows the current plan', profile: 'solid', tags: ['@critical'] },
      { file: 'tests/billing.spec.ts', title: 'exports an invoice', profile: 'chronicFlaky' },
      { file: 'tests/audit.spec.ts', title: 'records an audit log', profile: 'flakyHistory' },
      { file: 'tests/reports.spec.ts', title: 'generates a CSV', profile: 'fixmeSkip' },
    ],
  },
]

function annotationsFor(profile: Profile, status: Status): NormTest['annotations'] {
  if (profile === 'fixmeSkip')
    return [{ type: 'fixme', description: 'flaky on CI - tracked in JIRA-412' }]
  if (status === 'skipped')
    return [{ type: 'skip', description: 'skipped on CI' }]
  return []
}

const isOwn = (trace: LoadedDemoTrace, def: TestDef): boolean => trace.file === def.file && trace.title === def.title

// Real traces from the demo suite (demo-traces/suite): a failed test opens a failing trace,
// a flaky one the passing trace of its retry. Tests of the suite get their own; the others
// borrow one from their project (else any), picked by title so reseeds stay identical.
function traceFor(traces: LoadedDemoTrace[], pdef: ProjectDef, def: TestDef, status: Status): LoadedDemoTrace | undefined {
  const wanted = status === 'unexpected' ? 'failed' : status === 'flaky' ? 'passed' : null
  if (!wanted)
    return undefined
  const pool = traces.filter(t => t.status === wanted)
  const own = pool.find(t => isOwn(t, def))
  if (own)
    return own
  const sameProject = pool.filter(t => pdef.tests.some(d => d.file === t.file))
  const from = sameProject.length ? sameProject : pool
  const h = [...def.title].reduce((a, c) => a + c.charCodeAt(0), 0)
  return from[h % from.length]
}

// The failure shown on the dashboard is the one recorded in the trace it opens.
function errorsFor(def: TestDef, line: number, trace: LoadedDemoTrace | undefined): NormTest['errors'] {
  if (!trace?.error)
    return []
  return [{ message: trace.error.message, stack: isOwn(trace, def) ? trace.error.stack : `at ${def.file}:${line + 4}:5` }]
}

function makeTest(traces: LoadedDemoTrace[], pdef: ProjectDef, def: TestDef, i: number, fallbackLine: number): { test: NormTest, trace?: LoadedDemoTrace } {
  const status = statusAt(def.profile, i)
  const titlePath = [def.file, def.title]
  // A test of the demo suite keeps its real location, so the card matches the trace header.
  const at = traces.find(t => isOwn(t, def))
  const line = at?.line ?? fallbackLine
  const trace = traceFor(traces, pdef, def, status)
  const norm: NormTest = {
    testKey: makeTestKey(def.file, titlePath, 'chromium'),
    title: def.title,
    titlePath,
    file: def.file,
    line,
    column: at?.column ?? 3,
    projectName: 'chromium',
    status,
    ok: status !== 'unexpected',
    duration: status === 'skipped' ? 0 : status === 'flaky' ? 800 + jitter(2500) : 200 + jitter(1800),
    retries: status === 'flaky' ? 1 : 0,
    tags: def.tags ?? [],
    annotations: annotationsFor(def.profile, status),
    errors: errorsFor(def, line, trace),
    attachments: [],
  }
  return { test: norm, trace }
}

function countsOf(tests: NormTest[]): Counts {
  const c: Counts = { total: tests.length, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  for (const t of tests)
    c[t.status]++
  return c
}

async function ensureUser(): Promise<string> {
  const existing = await db.query.user.findFirst({ where: eq(userTable.email, EMAIL), columns: { id: true } })
  if (existing)
    return existing.id
  const res = await auth.api.signUpEmail({ body: { email: EMAIL, password: PASSWORD, name: NAME } })
  return res.user.id
}

// The signup hook auto-creates a personal org; resolve the one this user owns.
async function ownedOrgId(userId: string): Promise<string> {
  const m = await db.query.member.findFirst({ where: eq(member.userId, userId), columns: { organizationId: true } })
  if (!m)
    throw new Error('seeded user has no organization')
  return m.organizationId
}

async function main(): Promise<void> {
  // Seeds a known-credentials demo account; refuse on prod unless explicitly forced.
  if (env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    logger.error(`Refusing to seed known credentials (${EMAIL}) in production. Re-run with --force if intended.`)
    process.exit(1)
  }

  const userId = await ensureUser()
  const orgId = await ownedOrgId(userId)
  const traces = await loadDemoTraces()

  await db.delete(project).where(eq(project.organizationId, orgId))
  const apiKey = await auth.api.createApiKey({ body: { name: 'ci-github-actions', userId } })
  await db.update(apikey).set({ referenceId: orgId }).where(eq(apikey.id, apiKey.id))

  for (const pdef of PROJECTS) {
    const projectId = randomUUID()
    await db.insert(project).values({ id: projectId, organizationId: orgId, slug: pdef.slug, name: pdef.name })

    for (let i = 0; i < RUNS; i++) {
      const startedAt = new Date(Date.now() - (LATEST - i) * DAY - jitter(6 * 3_600_000))
      const made = pdef.tests.map((d, idx) => makeTest(traces, pdef, d, i, 12 + idx * 9))
      const tests = made.map(m => m.test)
      // Readable run id: it's the run-page heading (the run table has no name column).
      const runId = `${pdef.slug}-run-${i + 1}`

      await db.insert(run).values({
        id: runId,
        projectId,
        startedAt,
        duration: tests.reduce((s, t) => s + t.duration, 0),
        counts: countsOf(tests),
        countsByTag: countsByTagFrom(tests),
        playwrightVersion: '1.60.0',
        git: { sha: Math.floor(rng() * 0xFFFFFFF).toString(16).padStart(7, '0'), branch: i % 4 === 1 ? 'develop' : 'main' },
        ci: { provider: 'github', runNumber: String(100 + i) },
      })

      const traced: { id: string, storageKey: string, buf: Buffer }[] = []
      const testRows = made.map(({ test: t, trace }) => {
        const id = randomUUID()
        const hasTrace = !!trace
        if (trace)
          traced.push({ id, storageKey: `${projectId}/${runId}/${randomUUID()}-trace.zip`, buf: trace.buf })
        return {
          id,
          runId,
          projectId,
          testKey: t.testKey,
          title: t.title,
          titlePath: t.titlePath,
          file: t.file,
          line: t.line,
          column: t.column,
          projectName: t.projectName,
          status: t.status,
          ok: t.ok,
          duration: t.duration,
          retries: t.retries,
          tags: t.tags,
          annotations: t.annotations,
          errors: t.errors,
          attachments: hasTrace
            ? [{ name: 'trace', contentType: 'application/zip', hasBody: true }]
            : t.attachments,
        }
      })
      await db.insert(test).values(testRows)

      for (const tr of traced)
        await storage.put(tr.storageKey, tr.buf)

      if (traced.length) {
        await db.insert(artifact).values(traced.map(tr => ({
          id: randomUUID(),
          projectId,
          runId,
          testId: tr.id,
          name: 'trace',
          contentType: 'application/zip',
          storageKey: tr.storageKey,
          size: tr.buf.length,
        })))
      }
    }
    logger.info(`seeded market project ${pdef.slug} (${RUNS} runs)`)
  }

  logger.info('-'.repeat(40))
  logger.info(`Login:     ${EMAIL} / ${PASSWORD}`)
  logger.info(`API token: ${apiKey.key}`)
  logger.info('-'.repeat(40))
  process.exit(0)
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
