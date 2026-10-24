import type { IngestRun, NormTest } from '@kinora/core'
import type { AuthType } from '../src/lib/auth'
import { makeTestKey } from '@kinora/core'
import { eq, sql } from 'drizzle-orm'
import { app } from '../src/app'
import { db } from '../src/db'
import { apikey, member } from '../src/db/schemas/index'
import { auth } from '../src/lib/auth'
import { appRouter } from '../src/router/index'

const TABLES = ['artifact', 'test_quarantine', 'test', 'run', 'project', 'subscription', 'usage_period', 'slack_integration', 'invitation', 'member', 'organization', 'apikey', 'device_code', 'verification', 'account', 'session', 'user']

export async function resetDb(): Promise<void> {
  await db.execute(sql.raw(`TRUNCATE ${TABLES.map(t => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`))
}

export async function createUser(email = 'user@test.dev') {
  const res = await auth.api.signUpEmail({ body: { email, password: 'password123', name: email } })
  return res.user
}

// The signup hook auto-creates a personal org; resolve the one this user owns.
export async function ownedOrgId(userId: string): Promise<string> {
  const m = await db.query.member.findFirst({ where: eq(member.userId, userId), columns: { organizationId: true } })
  if (!m)
    throw new Error('user has no organization')
  return m.organizationId
}

export async function createApiKey(userId: string): Promise<string> {
  const res = await auth.api.createApiKey({ body: { name: 'integration', userId } })
  // Ingest tokens reference the owning org.
  await db.update(apikey).set({ referenceId: await ownedOrgId(userId) }).where(eq(apikey.id, res.id))
  return res.key
}

export async function caller(user: { id: string }, organizationId?: string) {
  const orgId = organizationId ?? await ownedOrgId(user.id)
  return appRouter.createCaller({ user: user as AuthType['user'], organizationId: orgId, req: new Request('http://test') })
}

export async function ingest(key: string | null, payload: IngestRun = runPayload(), extraHeaders: Record<string, string> = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...extraHeaders }
  if (key)
    headers.Authorization = `Bearer ${key}`
  return app.request('/api/v1/runs', { method: 'POST', headers, body: JSON.stringify(payload) })
}

export function runPayload(slug = 'web-app', tag = '@smoke', status: NormTest['status'] = 'expected'): IngestRun {
  const file = 'tests/checkout.spec.ts'
  const titlePath = [file, 'completes a purchase']
  const counts = { total: 1, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  counts[status] = 1
  return {
    project: { slug, name: slug },
    run: {
      startedAt: new Date().toISOString(),
      duration: 1234,
      counts,
    },
    tests: [{
      testKey: makeTestKey(file, titlePath, 'chromium'),
      title: 'completes a purchase',
      titlePath,
      file,
      line: 12,
      column: 3,
      projectName: 'chromium',
      status,
      ok: status !== 'unexpected',
      duration: 1234,
      retries: 0,
      tags: [tag],
      annotations: [],
      errors: [],
      attachments: [],
    }],
  }
}
