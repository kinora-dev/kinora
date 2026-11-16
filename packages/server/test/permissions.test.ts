import { randomUUID } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { member } from '../src/db/schemas/index'
import { caller, createApiKey, createUser, ingest, ownedOrgId, resetDb } from './helpers'

beforeEach(resetDb)

// orgA owned by A; B joins as a plain member.
async function orgWithMember() {
  const a = await createUser('a@test.dev')
  const b = await createUser('b@test.dev')
  const orgA = await ownedOrgId(a.id)
  await db.insert(member).values({ id: randomUUID(), organizationId: orgA, userId: b.id, role: 'member' })
  return { a, b, orgA }
}

describe('role permissions (adminProcedure)', () => {
  it('a member cannot create tokens, but can still list them', async () => {
    const { a, b, orgA } = await orgWithMember()

    await expect((await caller(b, orgA)).tokens.create({ name: 'x' })).rejects.toThrow()

    // owner creates one; the member can read the list (view) but not mint
    await (await caller(a, orgA)).tokens.create({ name: 'ci' })
    expect(await (await caller(b, orgA)).tokens.list()).toHaveLength(1)
  })

  it('a member cannot delete a project; the owner can', async () => {
    const { a, b, orgA } = await orgWithMember()
    await ingest(await createApiKey(a.id)) // seeds web-app in orgA

    await expect((await caller(b, orgA)).project.delete({ projectId: 'web-app' })).rejects.toThrow()

    await (await caller(a, orgA)).project.delete({ projectId: 'web-app' })
    expect((await (await caller(a, orgA)).dashboard.projects())).toHaveLength(0)
  })

  it('a member cannot configure alerts', async () => {
    const { b, orgA } = await orgWithMember()

    await expect(
      (await caller(b, orgA)).alerts.upsert({
        projectId: 'web-app',
        webhookUrl: 'https://hooks.slack.com/services/x',
        policy: 'on-failure',
        enabled: true,
      }),
    ).rejects.toThrow()
  })
})
