import type { NormTest } from '@kinora/core'
import type { PinnedTrace } from '../db/schemas/index'
import { and, asc, desc, eq, gt, inArray, isNotNull, isNull, lte, or } from 'drizzle-orm'
import { db } from '../db'
import { artifact, run, test, testQuarantine } from '../db/schemas/index'
import { logger } from '../lib/logger'
import { storage } from '../lib/storage'

interface ProjectRow { id: string }

export function activeQuarantineWhere(projectId: string) {
  return and(
    eq(testQuarantine.projectId, projectId),
    or(isNull(testQuarantine.expiresAt), gt(testQuarantine.expiresAt, new Date())),
  )
}

export interface QuarantinedTest {
  testKey: string
  reason?: string
  expiresAt?: string
  // Where the test lives, from its stored results; absent once retention removed every one of them.
  test?: Pick<NormTest, 'file' | 'titlePath' | 'projectName'>
}

// Active quarantines with the identity CI needs to name each test in a Playwright test list. Every
// result of a test key shares that identity, so any one row gives it.
export async function loadQuarantinedTests(p: ProjectRow): Promise<QuarantinedTest[]> {
  const rows = await db.query.testQuarantine.findMany({ where: activeQuarantineWhere(p.id), orderBy: testQuarantine.testKey })
  if (!rows.length)
    return []
  const located = await db.selectDistinctOn([test.testKey], { testKey: test.testKey, file: test.file, titlePath: test.titlePath, projectName: test.projectName })
    .from(test)
    .where(and(eq(test.projectId, p.id), inArray(test.testKey, rows.map(r => r.testKey))))
    .orderBy(test.testKey)
  const byKey = new Map(located.map(t => [t.testKey, t]))
  return rows.map((q) => {
    const t = byKey.get(q.testKey)
    return {
      testKey: q.testKey,
      ...(q.reason && { reason: q.reason }),
      ...(q.expiresAt && { expiresAt: q.expiresAt.toISOString() }),
      ...(t && { test: { file: t.file, titlePath: t.titlePath, projectName: t.projectName } }),
    }
  })
}

const FAILING: NormTest['status'][] = ['unexpected', 'flaky']

function isTrace(a: { name: string, contentType: string }): boolean {
  return a.name === 'trace' || a.contentType === 'application/zip'
}

interface PinCandidate extends PinnedTrace {
  key: string
}

// Only the first pin sticks: it is the failure a later fix gets compared against.
async function pin(projectId: string, testKey: string, c: PinCandidate): Promise<void> {
  const { key, ...trace } = c
  await db.update(testQuarantine)
    .set({ pinnedTraceKey: key, pinnedTrace: trace })
    .where(and(activeQuarantineWhere(projectId), eq(testQuarantine.testKey, testKey), isNull(testQuarantine.pinnedTraceKey)))
}

// Pin the trace of the test's latest failure, the one that got it quarantined. Incident runs say
// nothing about the test, so they are skipped.
export async function pinLatestFailureTrace(projectId: string, testKey: string): Promise<void> {
  const [hit] = await db
    .select({ key: artifact.storageKey, size: artifact.size, runId: run.id, startedAt: run.startedAt, git: run.git, status: test.status })
    .from(artifact)
    .innerJoin(test, eq(artifact.testId, test.id))
    .innerJoin(run, eq(artifact.runId, run.id))
    .where(and(
      eq(test.projectId, projectId),
      eq(test.testKey, testKey),
      inArray(test.status, FAILING),
      or(eq(artifact.name, 'trace'), eq(artifact.contentType, 'application/zip')),
      isNull(run.incident),
    ))
    .orderBy(desc(run.startedAt), asc(artifact.createdAt))
    .limit(1)
  if (hit)
    await pin(projectId, testKey, { key: hit.key, runId: hit.runId, startedAt: hit.startedAt.toISOString(), status: hit.status, ...(hit.git?.sha && { sha: hit.git.sha }), ...(hit.size != null && { size: hit.size }) })
}

// A quarantined test with no trace pinned yet gets the first failing trace uploaded for it.
export async function pinUploadedTrace(
  r: { id: string, projectId: string, startedAt: Date, git: { sha?: string } | null, incident: unknown },
  t: { testKey: string, status: NormTest['status'] },
  a: { key: string, name: string, contentType: string, size: number },
): Promise<void> {
  if (r.incident || !FAILING.includes(t.status) || !isTrace(a))
    return
  await pin(r.projectId, t.testKey, { key: a.key, runId: r.id, startedAt: r.startedAt.toISOString(), status: t.status, ...(r.git?.sha && { sha: r.git.sha }), size: a.size })
}

// The given blob keys that a quarantine still pins: retention and shard re-runs must keep them.
export async function pinnedKeys(keys: string[]): Promise<Set<string>> {
  if (!keys.length)
    return new Set()
  const rows = await db.select({ key: testQuarantine.pinnedTraceKey }).from(testQuarantine).where(inArray(testQuarantine.pinnedTraceKey, keys))
  return new Set(rows.map(r => r.key!))
}

// Pinned blobs of these projects, for deleting a project or an account along with its artifacts.
export async function pinnedKeysOfProjects(projectIds: string[]): Promise<string[]> {
  if (!projectIds.length)
    return []
  const rows = await db.select({ key: testQuarantine.pinnedTraceKey }).from(testQuarantine).where(and(inArray(testQuarantine.projectId, projectIds), isNotNull(testQuarantine.pinnedTraceKey)))
  return rows.map(r => r.key!)
}

// Once no quarantine pins it, a blob whose artifact row retention already removed has no owner left.
export async function deleteUnpinnedOrphan(key: string): Promise<void> {
  const [owned, pinned] = await Promise.all([
    db.query.artifact.findFirst({ where: eq(artifact.storageKey, key), columns: { id: true } }),
    db.query.testQuarantine.findFirst({ where: eq(testQuarantine.pinnedTraceKey, key), columns: { id: true } }),
  ])
  if (owned || pinned)
    return
  await storage.delete(key).catch(error => logger.error({ error, key }, 'quarantine: pinned trace delete failed'))
}

// Expired quarantines stop pinning their trace, so retention can reclaim it.
export async function releaseExpiredPins(now = new Date()): Promise<number> {
  const rows = await db.select({ id: testQuarantine.id, key: testQuarantine.pinnedTraceKey })
    .from(testQuarantine)
    .where(and(isNotNull(testQuarantine.pinnedTraceKey), lte(testQuarantine.expiresAt, now)))
  for (const row of rows) {
    await db.update(testQuarantine).set({ pinnedTraceKey: null, pinnedTrace: null }).where(eq(testQuarantine.id, row.id))
    await deleteUnpinnedOrphan(row.key!)
  }
  return rows.length
}
