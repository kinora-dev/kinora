import { and, count, eq, sql, sum } from 'drizzle-orm'
import { db } from '../db'
import { artifact, project, testQuarantine, usagePeriod } from '../db/schemas/index'

export function periodKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

// A run that executed before the workspace existed is imported history: free, never metered and
// never counted against the current period. Anything dated later counts when it is received, so
// the client-supplied date cannot be used to dodge the quota or billing.
export function isHistory(startedAt: Date, organizationCreatedAt: Date): boolean {
  return startedAt < organizationCreatedAt
}

// `at` picks the period: the reception time for billable runs, the run's own date for history.
export async function recordResults(executor: Pick<typeof db, 'insert'>, organizationId: string, at: Date, results: number): Promise<void> {
  if (results <= 0)
    return
  await executor
    .insert(usagePeriod)
    .values({ organizationId, period: periodKey(at), results })
    .onConflictDoUpdate({
      target: [usagePeriod.organizationId, usagePeriod.period],
      set: { results: sql`${usagePeriod.results} + excluded.results`, updatedAt: new Date() },
    })
}

// Read from the counter, not the `test` rows: retention deletes those within the month on short
// windows (free = 7 days), which would otherwise give the quota back.
export async function currentPeriodResults(organizationId: string): Promise<number> {
  const row = await db.query.usagePeriod.findFirst({
    where: and(eq(usagePeriod.organizationId, organizationId), eq(usagePeriod.period, periodKey(new Date()))),
    columns: { results: true },
  })

  return row?.results ?? 0
}

// Bytes currently stored for an org. Retention purges shrink it, so it is a live total, not a period one.
export async function storageBytes(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ total: sum(artifact.size) })
    .from(artifact)
    .innerJoin(project, eq(artifact.projectId, project.id))
    .where(eq(project.organizationId, organizationId))
  // Traces a quarantine keeps after retention removed their artifact row still take space.
  const [pinned] = await db
    .select({ total: sql<string | null>`sum((${testQuarantine.pinnedTrace}->>'size')::bigint)` })
    .from(testQuarantine)
    .innerJoin(project, eq(testQuarantine.projectId, project.id))
    .where(and(
      eq(project.organizationId, organizationId),
      sql`${testQuarantine.pinnedTraceKey} is not null`,
      sql`not exists (select 1 from ${artifact} where ${artifact.storageKey} = ${testQuarantine.pinnedTraceKey})`,
    ))

  return Number(row?.total ?? 0) + Number(pinned?.total ?? 0)
}

export async function projectCount(organizationId: string): Promise<number> {
  const [row] = await db
    .select({ total: count() })
    .from(project)
    .where(eq(project.organizationId, organizationId))

  return row?.total ?? 0
}
