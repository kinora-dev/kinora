import { and, desc, eq, inArray, lt, notInArray } from 'drizzle-orm'
import { db } from '../db'
import { artifact, project, run, subscription, test } from '../db/schemas/index'
import { cloud, retentionPolicy } from '../lib/env'
import { logger } from '../lib/logger'
import { storage } from '../lib/storage'
import { pinnedKeys, releaseExpiredPins } from '../reports/quarantine'
import { retentionDaysFor } from './entitlements'

const BATCH = 500
const DAY_MS = 24 * 60 * 60 * 1000

interface Scope {
  includeOrgs?: string[]
  excludeOrgs?: string[]
  projectIds?: string[]
}

function cutoff(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS)
}

// Counts the blobs a sweep could not delete. Their rows are removed regardless, so those objects
// stay orphaned in storage: the caller reports the total instead of one error per key.
export interface PurgeStats {
  blobFailures: number
}

async function deleteBlobs(keys: string[], stats?: PurgeStats): Promise<void> {
  const pinned = await pinnedKeys(keys)
  for (const key of keys) {
    if (pinned.has(key))
      continue
    try {
      await storage.delete(key)
    }
    catch (error) {
      logger.error({ error, key }, 'retention: blob delete failed')
      if (stats)
        stats.blobFailures++
    }
  }
}

export async function purgeScope(before: Date, scope: Scope, stats?: PurgeStats): Promise<number> {
  // A tier with no users on it: nothing to do.
  if (scope.includeOrgs && scope.includeOrgs.length === 0)
    return 0

  let total = 0
  let fetched = BATCH
  while (fetched === BATCH) {
    const conds = [lt(run.startedAt, before)]
    if (scope.includeOrgs)
      conds.push(inArray(project.organizationId, scope.includeOrgs))
    if (scope.excludeOrgs && scope.excludeOrgs.length > 0)
      conds.push(notInArray(project.organizationId, scope.excludeOrgs))
    if (scope.projectIds)
      conds.push(inArray(run.projectId, scope.projectIds))

    const batch = await db
      .select({ id: run.id })
      .from(run)
      .innerJoin(project, eq(run.projectId, project.id))
      .where(and(...conds))
      .limit(BATCH)

    fetched = batch.length
    if (fetched === 0)
      break

    const ids = batch.map(b => b.id)

    // Blobs first: the run delete cascades the artifact rows, taking the keys with it.
    const blobs = await db
      .select({ key: artifact.storageKey })
      .from(artifact)
      .where(inArray(artifact.runId, ids))
    await deleteBlobs(blobs.map(b => b.key), stats)

    await db.delete(run).where(inArray(run.id, ids))
    total += fetched
  }

  return total
}

// Mark the attachments whose file was just deleted as expired, so the dashboard says the trace or
// images expired instead of showing a dead badge (an attachment never uploaded has no file either).
async function markExpired(deleted: { testId: string | null, name: string }[]): Promise<void> {
  const byTest = new Map<string, Set<string>>()
  for (const d of deleted) {
    if (d.testId)
      byTest.set(d.testId, (byTest.get(d.testId) ?? new Set()).add(d.name))
  }
  if (!byTest.size)
    return
  const rows = await db.select({ id: test.id, attachments: test.attachments }).from(test).where(inArray(test.id, [...byTest.keys()]))
  for (const row of rows) {
    const names = byTest.get(row.id)!
    await db.update(test)
      .set({ attachments: row.attachments.map(a => (names.has(a.name) ? { ...a, expired: true } : a)) })
      .where(eq(test.id, row.id))
  }
}

// Drop the blobs of older runs but keep the rows: pass rates, trends and flaky history survive,
// the attachment loses its URL at read time and is marked expired.
export async function purgeArtifactsBefore(before: Date, stats?: PurgeStats): Promise<number> {
  let total = 0
  let fetched = BATCH
  while (fetched === BATCH) {
    const batch = await db
      .select({ id: artifact.id, key: artifact.storageKey, testId: artifact.testId, name: artifact.name })
      .from(artifact)
      .innerJoin(run, eq(artifact.runId, run.id))
      .where(lt(run.startedAt, before))
      .limit(BATCH)

    fetched = batch.length
    if (fetched === 0)
      break

    await deleteBlobs(batch.map(b => b.key), stats)
    await markExpired(batch)
    await db.delete(artifact).where(inArray(artifact.id, batch.map(b => b.id)))
    total += fetched
  }

  return total
}

// Keep the newest `keep` runs of every project. Runs sharing the boundary timestamp are all kept.
export async function purgeBeyondLastRuns(keep: number, stats?: PurgeStats): Promise<number> {
  if (keep <= 0)
    return 0

  const projects = await db.select({ id: project.id }).from(project)
  let deleted = 0
  for (const p of projects) {
    const [boundary] = await db
      .select({ startedAt: run.startedAt })
      .from(run)
      .where(eq(run.projectId, p.id))
      .orderBy(desc(run.startedAt))
      .offset(keep - 1)
      .limit(1)
    if (!boundary)
      continue
    deleted += await purgeScope(boundary.startedAt, { projectIds: [p.id] }, stats)
  }

  return deleted
}

export interface PurgeResult extends PurgeStats {
  deleted: number
  artifacts: number
}

async function purgeSelfHost(now: Date): Promise<PurgeResult> {
  await releaseExpiredPins(now)
  if (!retentionPolicy)
    return { deleted: 0, artifacts: 0, blobFailures: 0 } // unconfigured self-host keeps everything

  const { runDays, keepLastRuns, artifactDays } = retentionPolicy
  const stats: PurgeStats = { blobFailures: 0 }
  let deleted = 0
  if (runDays > 0)
    deleted += await purgeScope(cutoff(now, runDays), {}, stats)
  deleted += await purgeBeyondLastRuns(keepLastRuns, stats)
  const artifacts = artifactDays > 0 ? await purgeArtifactsBefore(cutoff(now, artifactDays), stats) : 0
  return { deleted, artifacts, ...stats }
}

// Delete runs (cascading tests + artifacts + their blobs) past each tier's retention window.
export async function purgeExpiredRuns(now: Date): Promise<PurgeResult> {
  if (!cloud)
    return purgeSelfHost(now)

  await releaseExpiredPins(now)
  const subs = await db
    .select({ organizationId: subscription.organizationId, tier: subscription.tier })
    .from(subscription)

  const teamOrgs = subs.filter(s => s.tier === 'team').map(s => s.organizationId)
  const proOrgs = subs.filter(s => s.tier === 'pro').map(s => s.organizationId)
  const paidOrgs = subs
    .filter(s => s.tier === 'team' || s.tier === 'pro' || s.tier === 'enterprise')
    .map(s => s.organizationId)

  const stats: PurgeStats = { blobFailures: 0 }
  let deleted = 0
  // free = everyone not on a paid plan (covers no subscription + tier 'free').
  deleted += await purgeScope(cutoff(now, retentionDaysFor('free')), { excludeOrgs: paidOrgs }, stats)
  deleted += await purgeScope(cutoff(now, retentionDaysFor('team')), { includeOrgs: teamOrgs }, stats)
  deleted += await purgeScope(cutoff(now, retentionDaysFor('pro')), { includeOrgs: proOrgs }, stats)
  // enterprise retention is unlimited: never purged.
  return { deleted, artifacts: 0, ...stats }
}
