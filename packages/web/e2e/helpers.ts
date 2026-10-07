import type { AppRouter } from '@kinora/server'
import type { Page } from '@playwright/test'
import type { inferRouterOutputs } from '@trpc/server'
import process from 'node:process'
import { expect } from '@playwright/test'

type Outputs = inferRouterOutputs<AppRouter>
type Me = NonNullable<Outputs['user']['me']>
type ServerConfig = Outputs['config']['get']
type Manifest = Outputs['dashboard']['manifest']
type RunReport = Outputs['dashboard']['run']

export const DEMO = { email: 'demo@kinora.dev', password: 'password123' }
// Owns the "Acme QA" workspace; demo is a member of it (set up by the seed).
export const TEAMMATE = { email: 'teammate@kinora.dev', password: 'password123' }

const SERVER_URL = process.env.E2E_SERVER_URL
if (!SERVER_URL)
  throw new Error('E2E_SERVER_URL must be set (configured by playwright.config.ts)')

export async function login(page: Page, creds = DEMO): Promise<void> {
  await page.goto('/login')
  await page.locator('input[type="email"]').fill(creds.email)
  await page.locator('input[type="password"]').fill(creds.password)
  await page.locator('button[type="submit"]').click()
  // Auth round-trip + SPA redirect races the default 5s under parallel CI load.
  await expect(page).toHaveURL('/', { timeout: 15_000 })
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

export function findTracedRun(page: Page): Promise<{ slug: string, runId: string }> {
  return findRun(page, t => t.attachments.some(a => a.url))
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
