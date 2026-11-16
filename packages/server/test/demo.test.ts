import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// `demo` is a module const read from env. setupFiles already loaded the real graph (demo=false),
// so flip the flag AND reset the module registry, then re-import so the graph re-evaluates with it.
vi.mock('../src/lib/env', async importOriginal => ({ ...(await importOriginal()), demo: true }))
vi.resetModules()

const { app } = await import('../src/app')
const { createContext } = await import('../src/trpc/context')
const { caller, createUser, ownedOrgId, resetDb } = await import('./helpers')

beforeEach(resetDb)

function ctxReq(): FetchCreateContextFnOptions {
  return { req: new Request('http://test') } as FetchCreateContextFnOptions
}

describe('demo mode', () => {
  it('config.get reports demo: true', async () => {
    const u = await createUser()
    expect((await (await caller(u)).config.get()).demo).toBe(true)
  })

  it('auto-sessions as the seeded primary owner without a cookie', async () => {
    const u = await createUser()
    const orgId = await ownedOrgId(u.id)

    const ctx = await createContext(ctxReq())
    expect(ctx.user?.id).toBe(u.id)
    expect(ctx.organizationId).toBe(orgId)
  })

  it('rejects tRPC mutations (read-only)', async () => {
    const u = await createUser()
    await expect((await caller(u)).project.rename({ projectId: 'web-app', name: 'x' })).rejects.toThrow(/read-only demo/i)
  })

  it('still allows tRPC queries', async () => {
    const u = await createUser()
    await expect((await caller(u)).dashboard.projects()).resolves.toBeTruthy()
  })

  it('blocks the public ingest API', async () => {
    const res = await app.request('/api/v1/runs', { method: 'POST', headers: { Authorization: 'Bearer x' } })
    expect(res.status).toBe(403)
  })

  it('blocks auth writes (sign-up)', async () => {
    const res = await app.request('/api/auth/sign-up/email', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    expect(res.status).toBe(403)
  })

  it('blocks the Slack OAuth flow (its callback writes outside tRPC)', async () => {
    const res = await app.request('/api/slack/install?projectId=web-app')
    expect(res.status).toBe(403)
  })

  it('/api/demo/session signs in the seeded owner and sets a cookie', async () => {
    await createUser() // seeded with the demo password

    const res = await app.request('/api/demo/session')
    expect(res.status).toBe(204)
    expect(res.headers.get('set-cookie')).toBeTruthy()
  })

  it('/api/demo/session works with a browser\'s headers, which carry the visitor IP for the sign-in rate limit', async () => {
    await createUser()

    const res = await app.request('/api/demo/session', {
      headers: { 'origin': 'http://localhost:5173', 'cookie': 'unrelated=1', 'x-forwarded-for': '203.0.113.7' },
    })
    expect(res.status).toBe(204)
    expect(res.headers.get('set-cookie')).toBeTruthy()
  })
})
