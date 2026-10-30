import type { IngestRun, NormTest, RunIncident, RunStatus, ShardProgress } from '@kinora/core'
import type { ShardSlot } from '../db/schemas/index'
import { randomUUID } from 'node:crypto'
import { countsByTagFrom, countsFromTests, detectIncident, mergeShardAttempt } from '@kinora/core'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../db'
import { artifact, run, test } from '../db/schemas/index'
import { toNormTest } from '../reports/queries'

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

// Postgres caps a statement at 65,535 bind parameters; a test row binds 20, so one insert topped
// out at a few thousand tests while a run may carry up to MAX_TESTS_PER_RUN.
const TEST_INSERT_BATCH = 1000

export async function insertTests(tx: Tx, runId: string, projectId: string, tests: NormTest[], shardIndex?: number): Promise<void> {
  const rows = tests.map(item => ({
    id: randomUUID(),
    runId,
    projectId,
    testKey: item.testKey,
    title: item.title,
    titlePath: item.titlePath,
    file: item.file,
    line: item.line,
    column: item.column,
    projectName: item.projectName,
    status: item.status,
    ok: item.ok,
    duration: Math.round(item.duration),
    retries: item.retries,
    tags: item.tags,
    annotations: item.annotations,
    errors: item.errors,
    // `expired` is the retention's to set, not a client's.
    attachments: item.attachments.map(({ expired: _expired, ...a }) => a),
    a11y: item.a11y ?? null,
    shardIndex: shardIndex ?? null,
  }))
  for (let i = 0; i < rows.length; i += TEST_INSERT_BATCH)
    await tx.insert(test).values(rows.slice(i, i + TEST_INSERT_BATCH))
}

export interface LandedShard {
  runId: string
  startedAt: Date
  slot: number
  // Results this upload adds to usage: the slot's first landing only.
  results: number
  status: RunStatus
  shardProgress: ShardProgress
  // The run became complete with this upload and nobody was notified yet.
  notify: boolean
  // Judged once every shard landed, unless someone decided by hand.
  incident: RunIncident | null
  // Blobs of the artifacts of replaced tests, deleted once the transaction committed.
  orphanedKeys: string[]
}

type GroupedRun = IngestRun['run'] & { groupKey: string, shard: { current: number, total: number } }

export function isGrouped(r: IngestRun['run']): r is GroupedRun {
  return !!r.groupKey && !!r.shard
}

// A later upload of a slot that already landed (a CI re-run, a replayed request) adds no results,
// so the result cap must not turn it away. A slot never un-lands, so checking outside the
// transaction is safe.
export async function refillsLandedSlot(projectId: string, r: GroupedRun): Promise<boolean> {
  const [row] = await db.select({ landed: run.shardsLanded }).from(run).where(and(eq(run.projectId, projectId), eq(run.groupKey, r.groupKey)))
  return !!row && String(r.shard.current) in row.landed
}

function progress(landed: Record<string, ShardSlot>, total: number): ShardProgress {
  return { landed: Object.keys(landed).filter(k => Number(k) <= total).length, total }
}

// Land one shard upload in the run of its group: the first shard creates the run, the next ones
// fill their slot, and a later attempt of a slot (CI re-run) replaces that slot's tests.
export async function landShard(tx: Tx, projectId: string, input: IngestRun & { run: GroupedRun }, billable: boolean): Promise<LandedShard> {
  const { groupKey, shard } = input.run
  const attempt = input.run.attempt ?? 1
  const slot = String(shard.current)
  const now = new Date()

  // Concurrent shards race to create the run; the partial unique index arbitrates, the row lock
  // then serializes them so each sees the slots the others filled.
  await tx.insert(run).values({
    id: randomUUID(),
    projectId,
    groupKey,
    shardsTotal: shard.total,
    status: 'open',
    startedAt: new Date(input.run.startedAt),
    duration: Math.round(input.run.duration),
    counts: input.run.counts,
    playwrightVersion: input.run.playwrightVersion,
    git: input.run.git,
    ci: input.run.ci,
    baseUrls: input.run.baseUrls,
  }).onConflictDoNothing({ target: [run.projectId, run.groupKey], where: sql`group_key is not null` })
  const [current] = await tx.select().from(run).where(and(eq(run.projectId, projectId), eq(run.groupKey, groupKey))).for('update')

  const total = current.shardsTotal ?? shard.total
  const landed = { ...current.shardsLanded }
  const prior = landed[slot]
  const unchanged = (): LandedShard => ({
    runId: current.id,
    startedAt: current.startedAt,
    slot: shard.current,
    results: 0,
    status: current.status,
    shardProgress: progress(landed, total),
    notify: false,
    orphanedKeys: [],
    incident: current.incident,
  })
  // A late upload of an attempt a re-run already superseded.
  if (prior && attempt < prior.attempt)
    return unchanged()

  let tests = input.tests
  const orphanedKeys: string[] = []
  if (prior) {
    const slotTests = and(eq(test.runId, current.id), eq(test.shardIndex, shard.current))
    const previous = await tx.select().from(test).where(slotTests)
    if (attempt > prior.attempt)
      tests = mergeShardAttempt(previous.map(t => toNormTest(t)), tests, attempt)
    if (previous.length) {
      const blobs = await tx.select({ key: artifact.storageKey }).from(artifact).where(inArray(artifact.testId, tx.select({ id: test.id }).from(test).where(slotTests)))
      orphanedKeys.push(...blobs.map(b => b.key))
      await tx.delete(test).where(slotTests)
    }
  }
  await insertTests(tx, current.id, projectId, tests, shard.current)

  landed[slot] = {
    attempt,
    landedAt: now.toISOString(),
    startedAt: input.run.startedAt,
    duration: input.run.duration,
    results: prior?.results ?? input.tests.length,
    metered: prior?.metered ?? !billable,
  }

  // Shards run in parallel: the run spans from the first shard's start to the last one's end.
  const slots = Object.values(landed)
  const start = Math.min(...slots.map(s => Date.parse(s.startedAt)))
  const end = Math.max(...slots.map(s => Date.parse(s.startedAt) + s.duration))
  const all = await tx.select({ status: test.status, tags: test.tags, errors: test.errors }).from(test).where(eq(test.runId, current.id))
  const complete = Array.from({ length: total }, (_, i) => String(i + 1)).every(k => k in landed)
  // A shard landing after the timeout closed the run still completes it.
  const status: RunStatus = complete ? 'complete' : current.status
  const notify = complete && !current.notifiedAt
  const incident = complete && !current.incidentDecision ? detectIncident(all, current.baseUrls ?? input.run.baseUrls) : current.incident

  await tx.update(run).set({
    counts: countsFromTests(all),
    countsByTag: countsByTagFrom(all),
    startedAt: new Date(start),
    duration: Math.round(end - start),
    shardsTotal: total,
    shardsLanded: landed,
    status,
    incident,
    ...(notify && { notifiedAt: now }),
    ...(!prior && billable ? { meterPending: true } : {}),
  }).where(eq(run.id, current.id))

  return {
    runId: current.id,
    startedAt: new Date(start),
    slot: shard.current,
    results: prior ? 0 : input.tests.length,
    status,
    shardProgress: progress(landed, total),
    notify,
    orphanedKeys,
    incident,
  }
}
