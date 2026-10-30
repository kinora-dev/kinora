import type { IngestRun, NormTest } from '@kinora/core'
import type { AppRouter } from '@kinora/server'
import type { Locator, Page } from '@playwright/test'
import type { inferRouterOutputs } from '@trpc/server'
import process from 'node:process'
import { makeTestKey } from '@kinora/core'
import { expect } from '@playwright/test'
import { scanA11y } from '../../reporter/src/a11y'

type Outputs = inferRouterOutputs<AppRouter>
type Me = NonNullable<Outputs['user']['me']>
type ServerConfig = Outputs['config']['get']
type Manifest = Outputs['dashboard']['manifest']
type RunReport = Outputs['dashboard']['run']

export const DEMO = { email: 'demo@kinora.dev', password: 'password123' }
// Owns the "Acme QA" workspace; demo is a member of it (set up by the seed).
export const TEAMMATE = { email: 'teammate@kinora.dev', password: 'password123' }

const serverUrl = process.env.E2E_SERVER_URL
if (!serverUrl)
  throw new Error('E2E_SERVER_URL must be set (configured by playwright.config.ts)')
export const SERVER_URL = serverUrl

export async function login(page: Page, creds = DEMO): Promise<void> {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(creds.email)
  await page.locator('input[type="password"]').fill(creds.password)
  await page.locator('button[type="submit"]').click()
  // Auth round-trip + SPA redirect races the default 5s under parallel CI load.
  await expect(page).toHaveURL('/', { timeout: 15_000 })
  await activateOwnedWorkspace(page)
}

// A new session reopens the user's last workspace, which parallel tests switching the shared demo
// user keep changing: pin each login to the owned workspace so tests do not depend on each other.
async function activateOwnedWorkspace(page: Page): Promise<void> {
  const api = `${SERVER_URL}/api/auth/organization`
  const active = await (await page.request.get(`${api}/get-active-member`)).json() as { role?: string } | null
  if (active?.role === 'owner')
    return
  const orgs = await (await page.request.get(`${api}/list`)).json() as { id: string }[]
  for (const org of orgs) {
    const { role } = await (await page.request.get(`${api}/get-active-member-role?organizationId=${org.id}`)).json() as { role?: string }
    if (role !== 'owner')
      continue
    const origin = new URL(page.url()).origin
    const res = await page.request.post(`${api}/set-active`, { data: { organizationId: org.id }, headers: { origin } })
    if (!res.ok())
      throw new Error(`set-active failed: ${res.status()} ${await res.text()}`)
    // The SPA already loaded the previous workspace.
    await page.reload()
    return
  }
}

export async function stubMe(page: Page, flags: { mailerEnabled?: boolean, emailVerified?: boolean }): Promise<void> {
  await page.route('**/trpc/**', async (route) => {
    const url = route.request().url()
    if (!url.includes('user.me') && !url.includes('config.get')) {
      await route.continue()
      return
    }
    const res = await route.fetch()
    const body = await res.json() as { result?: { data?: Record<string, unknown> } }[]
    for (const entry of body) {
      const data = entry?.result?.data
      if (!data || typeof data !== 'object')
        continue
      if (flags.emailVerified !== undefined && 'emailVerified' in data)
        (data as Me).emailVerified = flags.emailVerified
      if (flags.mailerEnabled !== undefined && 'mailerEnabled' in data)
        (data as ServerConfig).mailerEnabled = flags.mailerEnabled
    }
    await route.fulfill({ response: res, json: body })
  })
}

// Hit a tRPC query with the logged-in session cookie.
async function query<T>(page: Page, path: string, input: unknown): Promise<T | undefined> {
  const url = `${SERVER_URL}/trpc/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ 0: input }))}`
  const res = await page.request.get(url)
  const json = await res.json() as [{ result?: { data?: T } }]
  return json[0]?.result?.data
}

// Components page: a story's tests are folded unless it is failing or flaky now. Opens it if needed.
export async function openStory(scope: Locator, story: string): Promise<void> {
  const toggle = scope.getByRole('button', { name: new RegExp(`^${story}, \\d+ tests?$`) })
  if (await toggle.getAttribute('aria-expanded') === 'false')
    await toggle.click()
  await expect(toggle).toHaveAttribute('aria-expanded', 'true')
}

// Mint an ingest token for the logged-in user's active workspace (plaintext is returned once).
export async function createApiToken(page: Page): Promise<string> {
  const res = await page.request.post(`${SERVER_URL}/trpc/tokens.create?batch=1`, { data: { 0: { name: `e2e-${Date.now()}` } } })
  const json = await res.json() as [{ result?: { data?: Outputs['tokens']['create'] } }]
  const key = json[0]?.result?.data?.key
  if (!key)
    throw new Error(`token.create failed: ${JSON.stringify(json)}`)
  return key
}

// Scan the page with axe and attach the result, without asserting: the nightly uploads this suite
// to kinora, where the violations show as warnings and feed the project's accessibility hotspots.
// Called from existing tests, on the main pages of the dashboard.
export async function scanPage(page: Page): Promise<void> {
  await scanA11y(page)
}

// Upload a run through the public ingest API, as a reporter would, so a test sets up exactly the
// data it checks instead of probing the randomly seeded runs. `backfill` keeps alerts quiet.
export async function postRun(page: Page, token: string, payload: IngestRun): Promise<void> {
  const res = await page.request.post(`${SERVER_URL}/api/v1/runs?backfill=1`, { headers: { Authorization: `Bearer ${token}` }, data: payload })
  expect(res.status(), await res.text()).toBe(201)
}

// A plain Playwright test result, for runs built with `runOf`.
export function testOf(file: string, title: string, status: NormTest['status']): NormTest {
  const titlePath = [file, title]
  return {
    testKey: makeTestKey(file, titlePath, 'chromium'),
    title,
    titlePath,
    file,
    line: 5,
    column: 3,
    projectName: 'chromium',
    status,
    ok: status !== 'unexpected',
    duration: 100,
    retries: status === 'flaky' ? 1 : 0,
    tags: [],
    annotations: [],
    errors: status === 'unexpected' ? [{ message: 'expect(received).toBe(expected)' }] : [],
    attachments: [],
  }
}

// A run of `slug` with the given tests, counts derived from their statuses.
export function runOf(slug: string, startedAt: Date, tests: NormTest[], git?: IngestRun['run']['git']): IngestRun {
  const counts = { total: tests.length, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  for (const t of tests)
    counts[t.status]++
  return { project: { slug, name: slug }, run: { startedAt: startedAt.toISOString(), duration: 100, counts, ...(git && { git }) }, tests }
}

// Find a run whose report has a test matching `pred` (which seeded tests get
// traces / annotations is randomised, so we probe rather than hardcode).
async function findRun(page: Page, pred: (test: RunReport['tests'][number]) => boolean): Promise<{ slug: string, runId: string }> {
  const manifest = await query<Manifest>(page, 'dashboard.manifest', {})
  for (const project of manifest?.projects ?? []) {
    for (const run of project.runs) {
      const report = await query<RunReport>(page, 'dashboard.run', { projectId: project.id, runId: run.runId })
      if (report?.tests.some(pred))
        return { slug: project.id, runId: run.runId }
    }
  }
  throw new Error('no matching run found - reseed with `pnpm --filter @kinora/server db:seed`')
}

// A hosted trace specifically: runs can also host images (failed screenshot assertions).
export function findTracedRun(page: Page): Promise<{ slug: string, runId: string }> {
  return findRun(page, t => t.attachments.some(a => a.url && a.name === 'trace'))
}

export function findAnnotatedRun(page: Page): Promise<{ slug: string, runId: string }> {
  return findRun(page, t => t.annotations.some(a => a.type === 'skip'))
}

export function findFailingRun(page: Page): Promise<{ slug: string, runId: string }> {
  return findRun(page, t => t.status === 'unexpected' && t.errors.length > 0)
}

// A project with >= 2 runs; returns the latest as head and the one before as base.
export async function findTwoRuns(page: Page): Promise<{ slug: string, base: string, head: string }> {
  const manifest = await query<Manifest>(page, 'dashboard.manifest', {})
  for (const p of manifest?.projects ?? []) {
    if (p.runs.length >= 2)
      return { slug: p.id, base: p.runs[1].runId, head: p.runs[0].runId }
  }
  throw new Error('no project with >=2 runs - reseed with `pnpm --filter @kinora/server db:seed`')
}
