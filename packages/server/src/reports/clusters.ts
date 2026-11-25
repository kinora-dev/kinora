import type { ClusterStatus, ClusterTriage, FailureCluster } from '@kinora/core'
import type { project, run } from '../db/schemas/index'
import { randomUUID } from 'node:crypto'
import { TRPCError } from '@trpc/server'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../db'
import { clusterTriage, member, user } from '../db/schemas/index'
import { matchCodeowners, parseCodeowners } from '../lib/codeowners'

type ProjectRow = typeof project.$inferSelect
type WindowRun = Pick<typeof run.$inferSelect, 'id' | 'startedAt'>
type TriageRow = typeof clusterTriage.$inferSelect

const assignee = alias(user, 'assignee')
const resolver = alias(user, 'resolver')
const updater = alias(user, 'updater')

type JoinedUser = { name: string | null, email: string | null } | null

function nameOf(u: JoinedUser): string | undefined {
  return (u?.name || u?.email) ?? undefined
}

function toTriage(row: TriageRow, users: { assignee: JoinedUser, resolver: JoinedUser, updater: JoinedUser }): ClusterTriage {
  const assigneeName = nameOf(users.assignee)
  return {
    status: row.status,
    ...(row.assigneeUserId && assigneeName && { assignee: { id: row.assigneeUserId, name: assigneeName } }),
    ...(row.issueUrl && { issueUrl: row.issueUrl }),
    ...(row.note && { note: row.note }),
    ...(row.snoozedAt && { snoozedAt: row.snoozedAt.toISOString() }),
    ...(row.snoozedUntil && { snoozedUntil: row.snoozedUntil.toISOString() }),
    ...(row.resolvedAt && { resolvedAt: row.resolvedAt.toISOString() }),
    ...(row.resolvedAt && nameOf(users.resolver) && { resolvedBy: nameOf(users.resolver) }),
    updatedAt: row.updatedAt.toISOString(),
    ...(nameOf(users.updater) && { updatedBy: nameOf(users.updater) }),
  }
}

// Triage of the given projects' clusters, by project id then fingerprint.
export async function loadTriage(projectIds: string[], fingerprint?: string): Promise<Map<string, Map<string, ClusterTriage>>> {
  const out = new Map<string, Map<string, ClusterTriage>>()
  if (!projectIds.length)
    return out
  const rows = await db
    .select({
      row: clusterTriage,
      assignee: { name: assignee.name, email: assignee.email },
      resolver: { name: resolver.name, email: resolver.email },
      updater: { name: updater.name, email: updater.email },
    })
    .from(clusterTriage)
    .leftJoin(assignee, eq(assignee.id, clusterTriage.assigneeUserId))
    .leftJoin(resolver, eq(resolver.id, clusterTriage.resolvedByUserId))
    .leftJoin(updater, eq(updater.id, clusterTriage.updatedByUserId))
    .where(and(inArray(clusterTriage.projectId, projectIds), fingerprint ? eq(clusterTriage.fingerprint, fingerprint) : undefined))
  for (const r of rows) {
    const byFp = out.get(r.row.projectId) ?? new Map<string, ClusterTriage>()
    byFp.set(r.row.fingerprint, toTriage(r.row, r))
    out.set(r.row.projectId, byFp)
  }
  return out
}

// Per cluster, the counted runs after its last failure that ran one of its tests: a fix holding,
// or a test no longer run at all (zero), read from the same window as the clusters.
async function quietRunCounts(runs: WindowRun[], clusters: FailureCluster[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  if (!clusters.length)
    return counts
  const earliest = Math.min(...clusters.map(c => Date.parse(c.lastSeen)))
  const later = runs.filter(r => r.startedAt.getTime() > earliest)
  if (!later.length)
    return counts
  const keys = [...new Set(clusters.flatMap(c => c.testKeys))]
  const rows = await db.execute<{ runId: string, testKey: string }>(sql`
    select distinct t.run_id as "runId", t.test_key as "testKey"
    from test t
    where t.run_id in (${sql.join(later.map(r => sql`${r.id}`), sql`, `)})
      and t.test_key in (${sql.join(keys.map(k => sql`${k}`), sql`, `)})
      and t.status <> 'skipped'`)
  const ran = new Map<string, Set<string>>()
  for (const r of rows.rows)
    ran.set(r.runId, (ran.get(r.runId) ?? new Set()).add(r.testKey))
  for (const c of clusters) {
    const since = Date.parse(c.lastSeen)
    counts.set(c.fingerprint, later.filter(r => r.startedAt.getTime() > since && c.testKeys.some(k => ran.get(r.id)?.has(k))).length)
  }
  return counts
}

// Adds what the runs alone don't say: the triage, the owners from CODEOWNERS, and the quiet runs.
export async function annotateClusters(p: ProjectRow, runs: WindowRun[], clusters: FailureCluster[]): Promise<FailureCluster[]> {
  if (!clusters.length)
    return clusters
  const [triage, quiet] = await Promise.all([loadTriage([p.id]), quietRunCounts(runs, clusters)])
  const rules = parseCodeowners(p.codeownersText)
  return clusters.map((c) => {
    const owners = rules.length ? [...new Set(c.files.flatMap(f => matchCodeowners(rules, f)))] : []
    const t = triage.get(p.id)?.get(c.fingerprint)
    return { ...c, quietRuns: quiet.get(c.fingerprint) ?? 0, ...(owners.length && { codeOwners: owners }), ...(t && { triage: t }) }
  })
}

export interface TriageChange {
  status?: ClusterStatus
  assigneeId?: string | null
  issueUrl?: string | null
  note?: string | null
  // A date ends the snooze then; 'recur' ends it with the next failure; null lifts it.
  snooze?: { until: string } | 'recur' | null
}

export async function saveTriage(p: ProjectRow, fingerprint: string, change: TriageChange, userId: string): Promise<ClusterTriage> {
  const existing = await db.query.clusterTriage.findFirst({
    where: and(eq(clusterTriage.projectId, p.id), eq(clusterTriage.fingerprint, fingerprint)),
  })
  const now = new Date()
  const set: Partial<typeof clusterTriage.$inferInsert> = { updatedByUserId: userId, updatedAt: now }

  if (change.status !== undefined) {
    set.status = change.status
    // Resolving again restarts the fix's clock, so a later failure reads as a regression of this fix.
    set.resolvedAt = change.status === 'resolved' ? now : null
    set.resolvedByUserId = change.status === 'resolved' ? userId : null
    if (change.status !== 'open') {
      set.snoozedAt = null
      set.snoozedUntil = null
    }
  }
  if (change.assigneeId !== undefined) {
    if (change.assigneeId) {
      const m = await db.query.member.findFirst({
        where: and(eq(member.userId, change.assigneeId), eq(member.organizationId, p.organizationId)),
        columns: { id: true },
      })
      if (!m)
        throw new TRPCError({ code: 'BAD_REQUEST', message: 'The assignee is not a member of this workspace' })
    }
    set.assigneeUserId = change.assigneeId
  }
  if (change.issueUrl !== undefined)
    set.issueUrl = change.issueUrl || null
  if (change.note !== undefined)
    set.note = change.note || null
  if (change.snooze !== undefined) {
    if (change.snooze && (change.status ?? existing?.status ?? 'open') !== 'open')
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Only an open cluster can be snoozed' })
    const until = change.snooze && change.snooze !== 'recur' ? new Date(change.snooze.until) : null
    if (until && until <= now)
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'A snooze must end in the future' })
    set.snoozedAt = change.snooze ? now : null
    set.snoozedUntil = until
  }

  await db.insert(clusterTriage)
    .values({ id: randomUUID(), projectId: p.id, fingerprint, status: 'open', createdAt: now, ...set })
    .onConflictDoUpdate({ target: [clusterTriage.projectId, clusterTriage.fingerprint], set })
  return (await loadTriage([p.id], fingerprint)).get(p.id)!.get(fingerprint)!
}
