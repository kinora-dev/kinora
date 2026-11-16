import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it } from 'vitest'
import { db } from '../src/db'
import { apikey } from '../src/db/schemas/index'
import { caller, createUser, ingest, ownedOrgId, resetDb } from './helpers'

beforeEach(resetDb)

describe('tokens router', () => {
  it('stamps the active org as the token referenceId', async () => {
    const a = await createUser()
    const orgId = await ownedOrgId(a.id)
    await (await caller(a)).tokens.create({ name: 'ci' })

    const keys = await db.query.apikey.findMany({ where: eq(apikey.referenceId, orgId) })
    expect(keys).toHaveLength(1)
    expect(keys[0]?.name).toBe('ci')
  })

  it('lists only the active org tokens', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    await (await caller(a)).tokens.create({ name: 'a-ci' })

    expect(await (await caller(a)).tokens.list()).toHaveLength(1)
    expect(await (await caller(b)).tokens.list()).toHaveLength(0)
  })

  it('a token created here ingests into its org', async () => {
    const a = await createUser()
    const { key } = await (await caller(a)).tokens.create({ name: 'ci' })

    const res = await ingest(key)
    expect(res.status).toBe(201)
    expect((await (await caller(a)).dashboard.projects())).toHaveLength(1)
  })

  it('is not rate limited by the api-key plugin default (10 req/day)', async () => {
    const a = await createUser()
    const { key } = await (await caller(a)).tokens.create({ name: 'ci' })

    for (let i = 0; i < 12; i++) {
      const res = await ingest(key)
      expect(res.status).toBe(201)
    }
  })

  it('cannot revoke a token from another org', async () => {
    const a = await createUser('a@test.dev')
    const b = await createUser('b@test.dev')
    const orgA = await ownedOrgId(a.id)
    await (await caller(a)).tokens.create({ name: 'a-ci' })
    const id = (await db.query.apikey.findMany({ where: eq(apikey.referenceId, orgA) }))[0]?.id
    expect(id).toBeTruthy()

    // b's org doesn't own the token: revoke is a no-op.
    await (await caller(b)).tokens.revoke({ id: id ?? '' })
    expect(await db.query.apikey.findMany({ where: eq(apikey.referenceId, orgA) })).toHaveLength(1)

    await (await caller(a)).tokens.revoke({ id: id ?? '' })
    expect(await db.query.apikey.findMany({ where: eq(apikey.referenceId, orgA) })).toHaveLength(0)
  })
})
