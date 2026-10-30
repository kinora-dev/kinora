import { randomUUID } from 'node:crypto'
import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { member } from '../src/db/schemas/index'
import { auth } from '../src/lib/auth'
import { caller, createApiKey, createUser, ingest, ownedOrgId, resetDb } from './helpers'

beforeEach(resetDb)

describe('organizations', () => {
  it('creates one owner organization on signup', async () => {
    const u = await createUser()
    const rows = await db.query.member.findMany({ where: eq(member.userId, u.id) })
    expect(rows).toHaveLength(1)
    expect(rows[0]?.role).toBe('owner')
  })

  it('a member sees the org projects; outsiders do not', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    const orgA = await ownedOrgId(a.id)
    await ingest(await createApiKey(a.id)) // a project lands in orgA

    // b joins orgA as a member
    await db.insert(member).values({ id: randomUUID(), organizationId: orgA, userId: b.id, role: 'member' })

    // b acting in orgA sees the shared project; b in their own org sees nothing
    expect((await (await caller(b, orgA)).dashboard.manifest()).projects).toHaveLength(1)
    expect((await (await caller(b)).dashboard.manifest()).projects).toHaveLength(0)
  })

  it('scopes a run query to the active org', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    const { runId } = await (await ingest(await createApiKey(a.id))).json() as { runId: string }

    // b, in their own org, cannot read a run that belongs to orgA
    await expect((await caller(b)).dashboard.run({ projectId: 'web-app', runId })).rejects.toThrow()
  })

  it('reopens a new session on the last workspace used, while still a member', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    const orgA = await ownedOrgId(a.id)
    const orgB = await ownedOrgId(b.id)
    const membership = { id: randomUUID(), organizationId: orgA, userId: b.id, role: 'member' }
    await db.insert(member).values(membership)

    const signIn = async () => {
      const { headers } = await auth.api.signInEmail({ body: { email: 'b@test.dev', password: 'password123' }, returnHeaders: true })
      return new Headers({ cookie: headers.get('set-cookie')!.split(';')[0]! })
    }
    const activeOrg = async (headers: Headers) => (await auth.api.getSession({ headers }))?.session.activeOrganizationId

    const first = await signIn()
    expect(await activeOrg(first)).toBe(orgB)
    await auth.api.setActiveOrganization({ body: { organizationId: orgA }, headers: first })
    expect(await activeOrg(await signIn())).toBe(orgA)

    // Removed from orgA: fall back to the owned workspace.
    await db.delete(member).where(eq(member.id, membership.id))
    expect(await activeOrg(await signIn())).toBe(orgB)
  })
})
