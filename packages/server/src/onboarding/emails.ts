import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq, gte, isNull, lt, lte, ne, notExists, or, sql } from 'drizzle-orm'
import { db } from '../db'
import { member, project, run, user } from '../db/schemas/index'
import { env } from '../lib/env'
import { logger } from '../lib/logger'
import { deliverMail } from '../lib/mailer'

export type OnboardingStep = 1 | 2

const DAY_MS = 24 * 60 * 60 * 1000
// Days after signup each nudge becomes due.
const STEP_DAYS: Record<OnboardingStep, number> = { 1: 2, 2: 7 }
// Older accounts are left alone, so a first deploy or a cron outage never mails a stale backlog.
const WINDOW_DAYS = 14

const SETUP_DOC_URL = 'https://docs.kinora.dev/getting-started'

// The latest nudge due for an account of this age, 0 when none yet.
export function dueStep(createdAt: Date, now: Date): 0 | OnboardingStep {
  const age = now.getTime() - createdAt.getTime()
  if (age >= STEP_DAYS[2] * DAY_MS)
    return 2
  if (age >= STEP_DAYS[1] * DAY_MS)
    return 1
  return 0
}

function signature(userId: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(`onboarding-unsubscribe:${userId}`).digest('base64url')
}

export function unsubscribeUrl(userId: string): string {
  return `${env.BASE_URL}/api/email/unsubscribe?u=${encodeURIComponent(userId)}&sig=${signature(userId)}`
}

export function verifyUnsubscribe(userId: string | undefined, sig: string | undefined): userId is string {
  if (!userId || !sig)
    return false
  const expected = Buffer.from(signature(userId))
  const got = Buffer.from(sig)
  return expected.length === got.length && timingSafeEqual(expected, got)
}

export function onboardingEmail(step: OnboardingStep, name: string | null, unsubscribe: string): { subject: string, text: string } {
  const greeting = `Hi${name ? ` ${name}` : ''},`
  const footer = `You're receiving this because you signed up for kinora. Stop these setup emails: ${unsubscribe}`
  if (step === 1) {
    return {
      subject: 'Send your first test run to kinora',
      text: `${greeting}\n\nYou created your kinora account a couple of days ago, but no test run has reached it yet.\n\nSetup takes a few minutes:\n\n1. Open your dashboard and create an API token: ${env.WEB_ORIGIN}\n2. Add the kinora reporter to your Playwright config (or Vitest, for browser mode and Storybook).\n3. Set KINORA_TOKEN in your CI secrets and run your tests.\n\nThe dashboard also gives you a prompt to paste into your AI coding agent, which sets it all up for you.\n\nStep-by-step guide: ${SETUP_DOC_URL}\n\nStuck somewhere? Just reply to this email.\n\n${footer}`,
    }
  }
  return {
    subject: 'Still no test runs in kinora',
    text: `${greeting}\n\nYour kinora workspace is still waiting for its first test run. If something got in the way (the CI setup, the token, a framework we don't support yet), we'd like to know: just reply with a line on what happened.\n\nIf you simply haven't had the time, the setup guide is here: ${SETUP_DOC_URL}\n\nThis is the last setup email we'll send.\n\n${footer}`,
  }
}

export interface OnboardingEmailResult {
  checked: number
  sent: number
  // Nudges that were due but whose mail did not leave; they are retried on the next run.
  undelivered: number
}

// Nudge recent accounts that never got a run in: once 2 days after signup, once at 7 days.
// Cloud only (the script gates it): a self-hosted instance never mails its users on its own.
export async function sendOnboardingEmails(now = new Date()): Promise<OnboardingEmailResult> {
  const hasRun = db
    .select({ one: sql`1` })
    .from(member)
    .innerJoin(project, eq(project.organizationId, member.organizationId))
    .innerJoin(run, eq(run.projectId, project.id))
    .where(eq(member.userId, user.id))

  const candidates = await db
    .select({ id: user.id, email: user.email, name: user.name, createdAt: user.createdAt, step: user.onboardingEmailStep })
    .from(user)
    .where(and(
      gte(user.createdAt, new Date(now.getTime() - WINDOW_DAYS * DAY_MS)),
      lte(user.createdAt, new Date(now.getTime() - STEP_DAYS[1] * DAY_MS)),
      lt(user.onboardingEmailStep, 2),
      eq(user.onboardingEmailsEnabled, true),
      // Unverified addresses are where bounces come from; keep them out to protect deliverability.
      eq(user.emailVerified, true),
      or(isNull(user.banned), eq(user.banned, false)),
      or(isNull(user.role), ne(user.role, 'admin')),
      notExists(hasRun),
    ))

  let sent = 0
  let undelivered = 0
  for (const candidate of candidates) {
    const due = dueStep(candidate.createdAt, now)
    // A late cron collapses both nudges into the latest one rather than sending two in a row.
    if (due === 0 || due <= candidate.step)
      continue
    const unsubscribe = unsubscribeUrl(candidate.id)
    const mail = onboardingEmail(due, candidate.name, unsubscribe)
    const delivered = await deliverMail({
      to: candidate.email,
      ...mail,
      headers: {
        'List-Unsubscribe': `<${unsubscribe}>`,
        'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
      },
    })
    if (!delivered) {
      undelivered++
      continue
    }
    sent++
    await db.update(user).set({ onboardingEmailStep: due }).where(eq(user.id, candidate.id))
    logger.info({ userId: candidate.id, step: due }, 'onboarding email sent')
  }

  return { checked: candidates.length, sent, undelivered }
}
