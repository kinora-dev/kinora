import type { NormTest, RunRegression, TestDelta } from '@kinora/core'
import { compareRuns, HEALTH_WINDOW, slowerThanUsual } from '@kinora/core'
import { and, desc, eq, isNull, lt, sql } from 'drizzle-orm'
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

// Ids of the most recent runs before `before`, newest first, optionally on a given branch.
async function latestRunIds(projectId: string, before: Date, branch: string | undefined, limit: number): Promise<string[]> {
  // A grouped run missing shards (still open, or closed incomplete) and a run cut short hold only
  // part of the suite, and an environment incident says nothing about the tests: none is a baseline.
  const conds = [eq(run.projectId, projectId), lt(run.startedAt, before), eq(run.status, 'complete'), isNull(run.interruption), isNull(run.incident)]
  if (branch)
    conds.push(sql`(${run.git} ->> 'branch') = ${branch}`)
  const rows = await db.select({ id: run.id }).from(run).where(and(...conds)).orderBy(desc(run.startedAt)).limit(limit)
  return rows.map(r => r.id)
}

// Id of the most recent run before `before`. Returns null when there is no such run (distinct from
// a run that legitimately recorded zero tests).
async function latestRunId(projectId: string, before: Date, branch?: string): Promise<string | null> {
  return (await latestRunIds(projectId, before, branch, 1))[0] ?? null
}

// Passes a test needs on the baseline before its usual duration means anything.
const MIN_USUAL_PASSES = 5

// Median and P90 duration of each test's passes over the given runs. Grouped by the key's byte
// order ("C"): sorting it by the database's locale doubles the cost.
async function usualDurations(runIds: string[]): Promise<Map<string, { median: number, p90: number }>> {
  if (!runIds.length)
    return new Map()
  const { rows } = await db.execute<{ testKey: string, median: number, p90: number }>(sql`
    select t.test_key collate "C" as "testKey",
      percentile_cont(0.5) within group (order by t.duration) as median,
      percentile_cont(0.9) within group (order by t.duration) as p90
    from test t
    where t.run_id in (${sql.join(runIds.map(id => sql`${id}`), sql`, `)}) and t.status = 'expected'
    group by t.test_key collate "C"
    having count(*) >= ${MIN_USUAL_PASSES}`)
  return new Map(rows.map(r => [r.testKey, { median: r.median, p90: r.p90 }]))
}

// The head's passing tests much slower than they usually are on `branch`.
async function slowerTests(projectId: string, headTests: NormTest[], before: Date, branch: string | undefined): Promise<NonNullable<RunRegression['slower']>> {
  const passed = headTests.filter(t => t.status === 'expected')
  if (!passed.length)
    return []
  const usual = await usualDurations(await latestRunIds(projectId, before, branch, HEALTH_WINDOW))
  return passed
    .flatMap((t) => {
      const u = usual.get(t.testKey)
      return u && slowerThanUsual(t.duration, u) ? [{ testKey: t.testKey, title: t.title, file: t.file, duration: t.duration, usual: Math.round(u.median) }] : []
    })
    .sort((a, b) => (b.duration - b.usual) - (a.duration - a.usual))
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

  const [baseTests, slower] = await Promise.all([
    testsOfRun(baseRunId),
    slowerTests(projectId, headTests, opts.startedAt, base === 'base-branch' ? opts.baseBranch : opts.branch),
  ])
  const deltas = compareRuns(baseTests, headTests)
  const pick = (d: TestDelta) => ({ testKey: d.testKey, title: d.title, file: d.file })
  // A test that is new in the PR (change 'added') but failing/flaky is a regression the PR introduced.
  const failing = (d: TestDelta): boolean => d.change === 'broken' || (d.change === 'added' && d.headStatus === 'unexpected')
  const flaking = (d: TestDelta): boolean => d.change === 'newly-flaky' || (d.change === 'added' && d.headStatus === 'flaky')
  return {
    base,
    newlyFailing: deltas.filter(failing).map(pick),
    newlyFlaky: deltas.filter(flaking).map(pick),
    fixed: deltas.filter(d => d.change === 'fixed').length,
    slower,
  }
}
