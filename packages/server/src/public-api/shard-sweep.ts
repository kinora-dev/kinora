import { countsFromTests, detectIncident } from '@kinora/core'
import { and, eq, isNull, lt } from 'drizzle-orm'
import { notifyRun } from '../alerts/notify'
import { db } from '../db'
import { project, run } from '../db/schemas/index'
import { env } from '../lib/env'
import { logger } from '../lib/logger'
import { shardState } from '../reports/queries'
import { testsOfRun } from '../reports/regression'

// How long a grouped run waits for its missing shards after the first one landed.
export const OPEN_RUN_TIMEOUT_MS = env.KINORA_SHARD_TIMEOUT_MINUTES * 60 * 1000
export const SHARD_SWEEP_INTERVAL_MS = 10 * 60 * 1000

// Close grouped runs still missing shards past the timeout as incomplete, and notify them once:
// a shard that died before uploading must not leave a run waiting (and silent) forever. The
// update claims each run, so concurrent sweeps on several instances never notify twice.
export async function closeStaleOpenRuns(now: Date): Promise<{ closed: number }> {
  const closed = await db.update(run)
    .set({ status: 'incomplete', notifiedAt: now })
    .where(and(eq(run.status, 'open'), isNull(run.notifiedAt), lt(run.createdAt, new Date(now.getTime() - OPEN_RUN_TIMEOUT_MS))))
    .returning({ id: run.id, projectId: run.projectId, startedAt: run.startedAt, git: run.git, groupKey: run.groupKey, status: run.status, shardsTotal: run.shardsTotal, shardsLanded: run.shardsLanded, baseUrls: run.baseUrls, incident: run.incident, incidentDecision: run.incidentDecision })

  for (const r of closed) {
    try {
      const owner = await db.query.project.findFirst({ where: eq(project.id, r.projectId), columns: { organizationId: true } })
      if (!owner)
        continue
      const tests = await testsOfRun(r.id)
      // The landed shards are all this run will have: judge them like a complete one.
      const incident = r.incidentDecision ? r.incident : detectIncident(tests, r.baseUrls ?? [])
      if (!r.incidentDecision)
        await db.update(run).set({ incident }).where(and(eq(run.id, r.id), isNull(run.incidentDecision)))
      await notifyRun({
        organizationId: owner.organizationId,
        projectId: r.projectId,
        runId: r.id,
        startedAt: r.startedAt,
        branch: r.git?.branch,
        counts: countsFromTests(tests),
        tests,
        incomplete: shardState(r).shardProgress,
        incident: incident ?? undefined,
      })
    }
    catch (error) {
      logger.error({ error, runId: r.id }, 'incomplete run notify failed')
    }
  }
  return { closed: closed.length }
}
