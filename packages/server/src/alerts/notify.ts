import type { Counts, NormTest, RunIncident, ShardProgress } from '@kinora/core'
import type { AlertPayload, AlertPolicy } from './core'
import { compareRuns, countsFromTests } from '@kinora/core'
import { and, eq, gt, isNull, or } from 'drizzle-orm'
import { getEntitlements } from '../billing/entitlements'
import { db } from '../db'
import { alertChannel, project, slackIntegration, testQuarantine } from '../db/schemas/index'
import { matchCodeowners, parseCodeowners } from '../lib/codeowners'
import { env } from '../lib/env'
import { logger } from '../lib/logger'
import { sendMail } from '../lib/mailer'
import { previousRunTests } from '../reports/regression'
import { shouldFire } from './core'
import { buildAlertEmail } from './email'
import { buildSlackMessage, sendSlack } from './slack'
import { postWebhook } from './webhook'

export interface NotifyRunInput {
  organizationId: string
  projectId: string
  runId: string
  startedAt: Date
  branch?: string
  counts: Counts
  tests: NormTest[]
  incomplete?: ShardProgress
  incident?: RunIncident
}

export async function notifyRun(input: NotifyRunInput): Promise<void> {
  // Alerts are a paid feature (self-host is unlimited).
  const entitlements = await getEntitlements(input.organizationId)
  if (!entitlements.alerts)
    return

  const slack = await db.query.slackIntegration.findFirst({
    where: eq(slackIntegration.projectId, input.projectId),
  })
  const channels = await db.select().from(alertChannel).where(eq(alertChannel.projectId, input.projectId))
  const activeSlack = slack?.enabled ? slack : null
  const activeChannels = channels.filter(c => c.enabled)
  // Skip the regression query when nothing is wired up.
  if (!activeSlack && activeChannels.length === 0)
    return

  const mutedRows = await db.query.testQuarantine.findMany({
    where: and(
      eq(testQuarantine.projectId, input.projectId),
      or(isNull(testQuarantine.expiresAt), gt(testQuarantine.expiresAt, new Date())),
    ),
    columns: { testKey: true },
  })
  const muted = new Set(mutedRows.map(q => q.testKey))
  const activeTests = input.tests.filter(t => !muted.has(t.testKey))

  // An environment incident is not compared: every test would read as newly failing.
  const prevTests = input.incident ? [] : await previousRunTests(input.projectId, input.startedAt, input.branch)
  const deltas = input.incident ? [] : compareRuns(prevTests, input.tests).filter(d => !muted.has(d.testKey))
  const newlyFailing = deltas.filter(d => d.change === 'broken')
  const newlyFlaky = deltas.filter(d => d.change === 'newly-flaky')

  const projectRow = await db.query.project.findFirst({
    where: eq(project.id, input.projectId),
    columns: { name: true, slug: true, codeownersText: true },
  })
  const slug = projectRow?.slug ?? input.projectId
  const codeowners = parseCodeowners(projectRow?.codeownersText)
  const codeOwners = Object.fromEntries(
    [...newlyFailing, ...newlyFlaky]
      .map(d => [d.title, matchCodeowners(codeowners, d.file)] as const)
      .filter(([, owners]) => owners.length > 0),
  )
  const payload: AlertPayload = {
    projectName: projectRow?.name ?? 'project',
    runUrl: `${env.WEB_ORIGIN}/projects/${slug}/runs/${input.runId}`,
    counts: countsFromTests(activeTests),
    newlyFailing: newlyFailing.map(d => d.title),
    newlyFlaky: newlyFlaky.map(d => d.title),
    codeOwners,
    ...(input.incomplete && { incomplete: input.incomplete }),
    ...(input.incident && { incident: input.incident }),
  }
  const fires = (policy: AlertPolicy): boolean =>
    shouldFire(policy, payload.counts, payload.newlyFailing.length, payload.newlyFlaky.length, !!payload.incomplete, !!payload.incident)

  if (activeSlack && fires(activeSlack.policy)) {
    try {
      await sendSlack(activeSlack.webhookUrl, buildSlackMessage(payload))
    }
    catch (error) {
      logger.error({ error, projectId: input.projectId }, 'slack alert failed')
    }
  }

  for (const ch of activeChannels) {
    if (!fires(ch.policy))
      continue
    try {
      if (ch.kind === 'email')
        sendMail({ to: ch.target, ...buildAlertEmail(payload) })
      else
        await postWebhook(ch.target, payload)
    }
    catch (error) {
      logger.error({ error, projectId: input.projectId, kind: ch.kind }, 'alert delivery failed')
    }
  }
}
