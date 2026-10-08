import type { Counts, NormTest } from '@kinora/core'
import type { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { countsByTagFrom, makeTestKey, STORY_ANNOTATION } from '@kinora/core'
import { and, eq } from 'drizzle-orm'
import { db } from '../src/db'
import { apikey, artifact, member, project, run, test, user as userTable } from '../src/db/schemas/index'
import { auth } from '../src/lib/auth'
import { env } from '../src/lib/env'
import { logger } from '../src/lib/logger'
import { storage } from '../src/lib/storage'
import { seedScreenshotComparison } from './seed-images'

const EMAIL = 'demo@kinora.dev'
const PASSWORD = 'password123'
const NAME = 'Demo User'

// Platform-admin account for the operator analytics dashboard (/admin, cloud-only).
const ADMIN_EMAIL = 'admin@kinora.dev'
const ADMIN_NAME = 'Kinora Admin'

// A second workspace the demo user is a member of, so the org switcher has two entries.
const MATE_EMAIL = 'teammate@kinora.dev'
const MATE_NAME = 'Acme QA'

// `stories` marks a component test: the story ids its `mount` calls would record.
// `snapshot` marks a visual test: its latest run fails `toHaveScreenshot` on that snapshot name.
interface TestDef { file: string, title: string, stories?: string[], snapshot?: string }

const PROJECTS: { slug: string, name: string, tests: TestDef[] }[] = [
  {
    slug: 'web-app',
    name: 'Web App',
    tests: [
      { file: 'tests/auth.spec.ts', title: 'logs in with valid credentials' },
      { file: 'tests/auth.spec.ts', title: 'rejects a wrong password' },
      { file: 'tests/checkout.spec.ts', title: 'adds an item to the cart' },
      { file: 'tests/checkout.spec.ts', title: 'completes a purchase' },
      { file: 'tests/checkout.spec.ts', title: 'applies a discount code' },
      { file: 'tests/search.spec.ts', title: 'returns relevant results' },
      { file: 'tests/search.spec.ts', title: 'handles an empty query' },
    ],
  },
  {
    slug: 'api-gateway',
    name: 'API Gateway',
    tests: [
      { file: 'tests/health.spec.ts', title: 'responds 200 on /healthz' },
      { file: 'tests/rate-limit.spec.ts', title: 'throttles past the quota' },
      { file: 'tests/auth.spec.ts', title: 'rejects an expired token' },
      { file: 'tests/proxy.spec.ts', title: 'forwards headers downstream' },
    ],
  },
  {
    slug: 'marketing-site',
    name: 'Marketing Site',
    tests: [
      { file: 'tests/home.spec.ts', title: 'renders the hero' },
      { file: 'tests/home.spec.ts', title: 'newsletter signup works' },
      { file: 'tests/pricing.spec.ts', title: 'toggles annual billing' },
    ],
  },
  {
    slug: 'design-system',
    name: 'Design System',
    tests: [
      { file: 'tests/components/button.spec.ts', title: 'primary button submits', stories: ['components/Button/Primary'] },
      { file: 'tests/components/button.spec.ts', title: 'disabled button ignores clicks', stories: ['components/Button/Disabled'] },
      { file: 'tests/components/button.spec.ts', title: 'button states match screenshots', stories: ['components/Button/Primary', 'components/Button/Disabled', 'components/Button/Loading'], snapshot: 'button-primary' },
      { file: 'tests/components/dialog.spec.ts', title: 'closes on escape', stories: ['components/Dialog/Default'] },
      // Playwright accepts a unique suffix of the story id; the dashboard folds it into the full id.
      { file: 'tests/components/dialog.spec.ts', title: 'traps focus', stories: ['Dialog/Default'] },
      { file: 'tests/components/select.spec.ts', title: 'opens with the keyboard', stories: ['components/Select/Default'] },
      { file: 'tests/components/select.spec.ts', title: 'filters options while typing', stories: ['components/Select/Searchable'] },
    ],
  },
]

const DAY = 86_400_000
const RUNS_PER_PROJECT = 10

// Bias toward passing, with occasional flaky / failed / skipped for realism.
function pickStatus(): NormTest['status'] {
  const r = Math.random()
  if (r < 0.82)
    return 'expected'
  if (r < 0.90)
    return 'flaky'
  if (r < 0.97)
    return 'unexpected'
  return 'skipped'
}

// One run must carry every shape the e2e finders probe for; random status picks
// alone can starve findAnnotatedRun (skipped is ~3%/test, so ~1.4% of seeds have none).
function coverStatuses(count: number): NormTest['status'][] {
  const required: NormTest['status'][] = ['unexpected', 'flaky', 'skipped']
  return Array.from({ length: count }, (_, i) => required[i] ?? 'expected')
}

function makeTest(def: TestDef, status: NormTest['status'], visualFailure = false): NormTest {
  const titlePath = [def.file, def.title]
  const failed = status === 'unexpected'
  const projectName = def.stories ? 'components' : 'chromium'
  return {
    testKey: makeTestKey(def.file, titlePath, projectName),
    title: def.title,
    titlePath,
    file: def.file,
    line: 10 + Math.floor(Math.random() * 40),
    column: 3,
    projectName,
    status,
    ok: status !== 'unexpected',
    duration: status === 'skipped' ? 0 : 200 + Math.floor(Math.random() * 4000),
    retries: status === 'flaky' ? 1 : 0,
    tags: def.file.includes('checkout') ? ['@smoke'] : [],
    // A skipped test never reaches `mount`, so it records no story.
    annotations: status === 'skipped'
      ? [{ type: 'skip', description: 'flaky on CI' }]
      : (def.stories ?? []).map(id => ({ type: STORY_ANNOTATION, description: id })),
    errors: !failed
      ? []
      : visualFailure
        ? [{ message: `expect(locator).toHaveScreenshot(expected) failed\n\n  1440 pixels (ratio 0.04 of all image pixels) are different.\n\n  Snapshot: ${def.snapshot}.png`, stack: `at ${def.file}:23:18` }]
        : [{ message: `expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500`, stack: `at ${def.file}:23:18` }],
    attachments: [],
  }
}

function countsOf(tests: NormTest[]): Counts {
  const c: Counts = { total: tests.length, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  for (const t of tests)
    c[t.status]++
  return c
}

async function ensureUser(email: string, name: string): Promise<string> {
  const existing = await db.query.user.findFirst({ where: eq(userTable.email, email), columns: { id: true } })
  if (existing)
    return existing.id
  const res = await auth.api.signUpEmail({ body: { email, password: PASSWORD, name } })
  return res.user.id
}

// Idempotent across reseeds: add the user to an org they don't already belong to.
async function ensureMembership(organizationId: string, userId: string, role: 'admin' | 'member'): Promise<void> {
  const existing = await db.query.member.findFirst({
    where: and(eq(member.organizationId, organizationId), eq(member.userId, userId)),
    columns: { id: true },
  })
  if (existing)
    return
  await db.insert(member).values({ id: randomUUID(), organizationId, userId, role })
}

// The signup hook auto-creates a personal org; resolve the one this user owns.
async function ownedOrgId(userId: string): Promise<string> {
  const m = await db.query.member.findFirst({ where: eq(member.userId, userId), columns: { organizationId: true } })
  if (!m)
    throw new Error('seeded user has no organization')
  return m.organizationId
}

// Failed tests get a real failing trace (carries error-context -> the viewer's "Copy prompt");
// flaky tests get a passing demo trace. Both make "View trace" work in dev.
const FAIL_TRACE = fileURLToPath(new URL('../../trace-viewer/public/fixtures/error-trace.zip', import.meta.url))
const PASS_TRACE = fileURLToPath(new URL('../../trace-viewer/public/fixtures/demo.zip', import.meta.url))

async function seedProjects(orgId: string, defs: typeof PROJECTS, failTrace: Buffer, passTrace: Buffer): Promise<void> {
  // Fresh data: cascade-deletes runs/tests/artifacts via FKs.
  await db.delete(project).where(eq(project.organizationId, orgId))

  for (const [pi, pdef] of defs.entries()) {
    const projectId = randomUUID()
    await db.insert(project).values({ id: projectId, organizationId: orgId, slug: pdef.slug, name: pdef.name })

    for (let i = RUNS_PER_PROJECT - 1; i >= 0; i--) {
      const startedAt = new Date(Date.now() - i * DAY - Math.floor(Math.random() * 6 * 3_600_000))
      const guaranteed = pi === 0 && i === RUNS_PER_PROJECT - 1
      const statuses = guaranteed ? coverStatuses(pdef.tests.length) : pdef.tests.map(() => pickStatus())
      // The latest run of a visual test always fails its screenshot, so the comparison view has data.
      const isVisualFailure = (d: TestDef) => i === 0 && !!d.snapshot
      const tests = pdef.tests.map((d, idx) => makeTest(d, isVisualFailure(d) ? 'unexpected' : statuses[idx], isVisualFailure(d)))
      const runId = randomUUID()

      await db.insert(run).values({
        id: runId,
        projectId,
        startedAt,
        duration: tests.reduce((s, t) => s + t.duration, 0),
        counts: countsOf(tests),
        countsByTag: countsByTagFrom(tests),
        playwrightVersion: '1.60.0',
        git: { sha: randomUUID().slice(0, 7), branch: i === 0 ? 'main' : 'develop' },
        ci: { provider: 'github', runNumber: String(100 + i) },
      })

      // Attach a trace to the tests a user would actually inspect (failed / flaky).
      const traced: { id: string, storageKey: string, buf: Buffer }[] = []
      const shots: { id: string, name: string, storageKey: string, buf: Buffer }[] = []
      const testRows = tests.map((t, idx) => {
        const id = randomUUID()
        const hasTrace = t.status === 'unexpected' || t.status === 'flaky'
        if (hasTrace)
          traced.push({ id, storageKey: `${projectId}/${runId}/${randomUUID()}-trace.zip`, buf: t.status === 'unexpected' ? failTrace : passTrace })
        const def = pdef.tests[idx]
        if (isVisualFailure(def)) {
          // Same three attachments, with the same names, as a failed `toHaveScreenshot`.
          for (const [part, buf] of Object.entries(seedScreenshotComparison())) {
            const name = `${def.snapshot}-${part}.png`
            shots.push({ id, name, storageKey: `${projectId}/${runId}/${randomUUID()}-${name}`, buf })
          }
        }
        const images = shots.filter(s => s.id === id).map(s => ({ name: s.name, contentType: 'image/png', hasBody: true }))
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
            ? [{ name: 'trace', contentType: 'application/zip', hasBody: true }, ...images]
            : t.attachments,
        }
      })
      await db.insert(test).values(testRows)

      for (const tr of traced)
        await storage.put(tr.storageKey, tr.buf)
      for (const shot of shots)
        await storage.put(shot.storageKey, shot.buf)

      if (shots.length) {
        await db.insert(artifact).values(shots.map(shot => ({
          id: randomUUID(),
          projectId,
          runId,
          testId: shot.id,
          name: shot.name,
          contentType: 'image/png',
          storageKey: shot.storageKey,
          size: shot.buf.length,
        })))
      }

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
    logger.info(`seeded project ${pdef.slug} (${RUNS_PER_PROJECT} runs)`)
  }
}

async function main(): Promise<void> {
  // Seeds a known-credentials demo account; refuse on prod unless explicitly forced.
  if (env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    logger.error(`Refusing to seed known credentials (${EMAIL}) in production. Re-run with --force if intended.`)
    process.exit(1)
  }

  const failTrace = await readFile(FAIL_TRACE)
  const passTrace = await readFile(PASS_TRACE)

  // Demo account: owner of its org with the full project set + an ingest token.
  const userId = await ensureUser(EMAIL, NAME)
  const orgId = await ownedOrgId(userId)
  await seedProjects(orgId, PROJECTS, failTrace, passTrace)

  const apiKey = await auth.api.createApiKey({ body: { name: 'seed token', userId } })
  // Ingest tokens reference the owning org, not the user.
  await db.update(apikey).set({ referenceId: orgId }).where(eq(apikey.id, apiKey.id))

  // Second workspace with its own project; the demo user joins as a member, so the
  // workspace switcher has two orgs to flip between.
  const mateId = await ensureUser(MATE_EMAIL, MATE_NAME)
  const mateOrgId = await ownedOrgId(mateId)
  await seedProjects(mateOrgId, PROJECTS.slice(1, 2), failTrace, passTrace)
  await ensureMembership(mateOrgId, userId, 'member')

  // Global admin: own account with the platform-admin role, so /admin is reachable on cloud.
  const adminId = await ensureUser(ADMIN_EMAIL, ADMIN_NAME)
  await db.update(userTable).set({ role: 'admin' }).where(eq(userTable.id, adminId))

  logger.info('-'.repeat(40))
  logger.info(`Login:     ${EMAIL} / ${PASSWORD}`)
  logger.info(`API token: ${apiKey.key}`)
  logger.info(`Switcher:  ${EMAIL} is also a member of ${MATE_NAME}'s workspace`)
  logger.info(`Admin:     ${ADMIN_EMAIL} / ${PASSWORD} (platform-admin role)`)
  logger.info('-'.repeat(40))
  process.exit(0)
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
