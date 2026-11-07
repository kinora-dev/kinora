import { eq } from 'drizzle-orm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../src/lib/mailer', async importOriginal => ({
  ...(await importOriginal<typeof import('../src/lib/mailer')>()),
  deliverMail: vi.fn(async () => true),
}))
vi.resetModules()

const { app } = await import('../src/app')
const { db } = await import('../src/db')
const { user } = await import('../src/db/schemas/index')
const { deliverMail } = await import('../src/lib/mailer')
const { dueStep, sendOnboardingEmails, unsubscribeUrl } = await import('../src/onboarding/emails')
const { createApiKey, createUser, ingest, resetDb } = await import('./helpers')

const mail = vi.mocked(deliverMail)
const DAY = 24 * 60 * 60 * 1000
const now = new Date('2026-11-07T12:00:00Z')

async function signedUp(daysAgo: number, email = 'new@test.dev') {
  const u = await createUser(email)
  await db.update(user).set({ createdAt: new Date(now.getTime() - daysAgo * DAY), emailVerified: true }).where(eq(user.id, u.id))
  return u
}

async function stepOf(userId: string) {
  const row = await db.query.user.findFirst({ where: eq(user.id, userId), columns: { onboardingEmailStep: true } })
  return row?.onboardingEmailStep
}

beforeEach(async () => {
  await resetDb()
  mail.mockClear()
  mail.mockResolvedValue(true)
})

describe('dueStep', () => {
  it('maps the account age to the latest nudge due', () => {
    expect(dueStep(new Date(now.getTime() - 1.9 * DAY), now)).toBe(0)
    expect(dueStep(new Date(now.getTime() - 2 * DAY), now)).toBe(1)
    expect(dueStep(new Date(now.getTime() - 7 * DAY), now)).toBe(2)
  })
})

describe('sendOnboardingEmails', () => {
  it('nudges at 2 days, again at 7, and never repeats a step', async () => {
    const u = await signedUp(3)
    expect(await sendOnboardingEmails(now)).toEqual({ checked: 1, sent: 1, undelivered: 0 })
    expect(mail.mock.calls[0]![0]).toMatchObject({
      to: 'new@test.dev',
      subject: 'Send your first test run to kinora',
      headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
    })
    expect((await sendOnboardingEmails(now)).sent).toBe(0)

    const later = new Date(now.getTime() + 5 * DAY)
    expect((await sendOnboardingEmails(later)).sent).toBe(1)
    expect(mail.mock.calls[1]![0].subject).toBe('Still no test runs in kinora')
    expect(await stepOf(u.id)).toBe(2)
    expect((await sendOnboardingEmails(new Date(later.getTime() + DAY))).checked).toBe(0)
  })

  it('sends only the latest nudge when the first one was missed', async () => {
    const u = await signedUp(8)
    expect((await sendOnboardingEmails(now)).sent).toBe(1)
    expect(mail).toHaveBeenCalledTimes(1)
    expect(mail.mock.calls[0]![0].subject).toBe('Still no test runs in kinora')
    expect(await stepOf(u.id)).toBe(2)
  })

  it('skips accounts that already sent a run', async () => {
    const u = await signedUp(3)
    await ingest(await createApiKey(u.id))
    expect(await sendOnboardingEmails(now)).toEqual({ checked: 0, sent: 0, undelivered: 0 })
  })

  it('skips accounts too young, too old, or unverified', async () => {
    await signedUp(1, 'young@test.dev')
    await signedUp(15, 'old@test.dev')
    const unverified = await signedUp(3, 'unverified@test.dev')
    await db.update(user).set({ emailVerified: false }).where(eq(user.id, unverified.id))
    expect((await sendOnboardingEmails(now)).checked).toBe(0)
  })

  it('retries next time when the mail could not be delivered', async () => {
    const u = await signedUp(3)
    mail.mockResolvedValueOnce(false)
    expect(await sendOnboardingEmails(now)).toEqual({ checked: 1, sent: 0, undelivered: 1 })
    expect(await stepOf(u.id)).toBe(0)
    expect((await sendOnboardingEmails(now)).sent).toBe(1)
  })
})

describe('unsubscribe link', () => {
  it('only shows a confirmation on GET, and opts out on POST', async () => {
    const u = await signedUp(3)
    const path = new URL(unsubscribeUrl(u.id)).pathname + new URL(unsubscribeUrl(u.id)).search

    expect((await app.request(path)).status).toBe(200)
    expect((await sendOnboardingEmails(now)).checked).toBe(1)

    expect((await app.request(path, { method: 'POST' })).status).toBe(200)
    expect((await sendOnboardingEmails(now)).checked).toBe(0)
  })

  it('rejects a tampered signature', async () => {
    const u = await signedUp(3)
    const res = await app.request(`/api/email/unsubscribe?u=${u.id}&sig=forged`, { method: 'POST' })
    expect(res.status).toBe(400)
    expect((await sendOnboardingEmails(now)).checked).toBe(1)
  })
})
