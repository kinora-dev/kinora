import type { NormTest, RunRegression, TestDelta } from '@kinora/core'
import { compareRuns } from '@kinora/core'
import { and, desc, eq, isNull, lt, ne, sql } from 'drizzle-orm'
import { db } from '../db'
import { run, test } from '../db/schemas/index'

type TestRow = typeof test.$inferSelect

function rowToNormTest(t: TestRow): NormTest {
  return {
    testKey: t.testKey,
    title: t.title,
    titlePath: t.titlePath,
    file: t.file,
    line: t.line,
    column: t.column,
    projectName: t.projectName,
    status: t.status,
    ok: t.ok,
    duration: t.duration,
    retries: t.retries,
    tags: t.tags,
    annotations: t.annotations,
    errors: t.errors,
    attachments: t.attachments,
  }
}

export async function testsOfRun(runId: string): Promise<NormTest[]> {
  const rows = await db.query.test.findMany({ where: eq(test.runId, runId) })
  return rows.map(rowToNormTest)
}

// Id of the most recent run before `before`, optionally on a given branch. Returns null when there
// is no such run (distinct from a run that legitimately recorded zero tests).
async function latestRunId(projectId: string, before: Date, branch?: string): Promise<string | null> {
  // A grouped run still waiting for shards holds only part of the suite, and an environment
  // incident says nothing about the tests: neither is a baseline.
  const conds = [eq(run.projectId, projectId), lt(run.startedAt, before), ne(run.status, 'open'), isNull(run.incident)]
  if (branch)
    conds.push(sql`(${run.git} ->> 'branch') = ${branch}`)
  const [prev] = await db.select({ id: run.id }).from(run).where(and(...conds)).orderBy(desc(run.startedAt)).limit(1)
  return prev?.id ?? null
}

// Tests of the most recent run on the same branch before this one (alerts baseline).
export async function previousRunTests(projectId: string, before: Date, branch?: string): Promise<NormTest[]> {
  const id = await latestRunId(projectId, before, branch)
  return id ? testsOfRun(id) : []
}

// Regression for the PR comment: diff head vs the base branch's latest run; fall back to the
// same-branch previous run; else nothing to compare against.
export async function computeRegression(
  projectId: string,
  headTests: NormTest[],
  opts: { branch?: string, baseBranch?: string, startedAt: Date },
): Promise<RunRegression> {
  let base: RunRegression['base'] = 'none'
  let baseRunId: string | null = null

  if (opts.baseBranch) {
    baseRunId = await latestRunId(projectId, opts.startedAt, opts.baseBranch)
    if (baseRunId)
      base = 'base-branch'
  }
  if (!baseRunId && opts.branch) {
    baseRunId = await latestRunId(projectId, opts.startedAt, opts.branch)
    if (baseRunId)
      base = 'previous-run'
  }
  if (!baseRunId)
    return { base: 'none', newlyFailing: [], newlyFlaky: [], fixed: 0 }

  const deltas = compareRuns(await testsOfRun(baseRunId), headTests)
  const pick = (d: TestDelta) => ({ testKey: d.testKey, title: d.title, file: d.file })
  // A test that is new in the PR (change 'added') but failing/flaky is a regression the PR introduced.
  const failing = (d: TestDelta): boolean => d.change === 'broken' || (d.change === 'added' && d.headStatus === 'unexpected')
  const flaking = (d: TestDelta): boolean => d.change === 'newly-flaky' || (d.change === 'added' && d.headStatus === 'flaky')
  return {
    base,
    newlyFailing: deltas.filter(failing).map(pick),
    newlyFlaky: deltas.filter(flaking).map(pick),
    fixed: deltas.filter(d => d.change === 'fixed').length,
  }
}
