import type { Counts, DashboardOverview, FailureCluster, NormError, NormTest, OverviewProject, ProjectEntry, ProjectHistory, ProjectRunsPage, RunReport, RunSummary, StatusCounts, TestHistory } from '@kinora/core'
import type { SQL } from 'drizzle-orm'
import type { PgSelect } from 'drizzle-orm/pg-core'
import type { CodeownersRule } from '../lib/codeowners'
import { applyTotals, buildFailureClusters, buildTestHistories, downsampleTrend, HEALTH_WINDOW, SCHEMA_VERSION, storiesOf, trendOf, trimPoints } from '@kinora/core'
import { and, asc, count, desc, eq, ilike, lte, sql } from 'drizzle-orm'
import { db } from '../db'
import { artifact, project, run, test } from '../db/schemas/index'
import { matchCodeowners, parseCodeowners } from '../lib/codeowners'
import { storage } from '../lib/storage'

type ProjectRow = typeof project.$inferSelect
type RunRow = typeof run.$inferSelect
type TestRow = typeof test.$inferSelect

// Most-recent runs per project the dashboard loads. Memory bound until the UI gets pagination;
// projects with more runs show this window in trends/history.
export const MAX_DASHBOARD_RUNS = 500

// A test search reads each project's newest runs only: `test` holds one row per test per run, so
// an unbounded scan grows with the whole history while people look for tests that still run.
const SEARCH_RUN_WINDOW = 20
export const MAX_SEARCH_RESULTS = 20
const MAX_SEARCH_TERMS = 8

// A test matching a search, as of its newest run in the search window.
export interface TestSearchHit {
  projectId: string
  projectName: string
  testKey: string
  title: string
  titlePath: string[]
  file: string
  status: NormTest['status']
  runId: string
  startedAt: string
}

export function runSummary(slug: string, r: RunRow): RunSummary {
  return {
    runId: r.id,
    projectId: slug,
    startedAt: r.startedAt.toISOString(),
    duration: r.duration,
    counts: r.counts,
    playwrightVersion: r.playwrightVersion ?? undefined,
    git: r.git ?? undefined,
    ci: r.ci ?? undefined,
    shards: r.shards ?? undefined,
    reportPath: `reports/${slug}/${r.id}.json`,
    countsByTag: r.countsByTag,
    ...shardState(r),
    ...incidentState(r),
  }
}

export function incidentState(r: Pick<RunRow, 'incident' | 'incidentDecision'>): Pick<RunSummary, 'incident' | 'incidentDecision'> {
  return { incident: r.incident ?? undefined, incidentDecision: r.incidentDecision ?? undefined }
}

// Runs whose failures count: an environment incident stays in the run list but out of every
// test's history, health and failure clusters.
function countedRuns(runs: RunRow[]): RunRow[] {
  return runs.filter(r => !r.incident)
}

// Only grouped runs carry a state: a single upload is complete by construction.
export function shardState(r: Pick<RunRow, 'groupKey' | 'status' | 'shardsTotal' | 'shardsLanded'>): Pick<RunSummary, 'status' | 'shardProgress'> {
  if (!r.groupKey || !r.shardsTotal)
    return {}
  const landed = Object.keys(r.shardsLanded).filter(k => Number(k) <= r.shardsTotal!).length
  return { status: r.status, shardProgress: { landed, total: r.shardsTotal } }
}

// Attachment names repeat within a test (two toHaveScreenshot assertions both attach "actual"),
// so urls are queued per name and handed out in upload order.
export function toNormTest(t: TestRow, urls?: Map<string, string[]>, codeowners?: CodeownersRule[]): NormTest {
  const seen = new Map<string, number>()
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
    attachments: t.attachments.map((a) => {
      const index = seen.get(a.name) ?? 0
      seen.set(a.name, index + 1)
      return { ...a, url: urls?.get(a.name)?.[index] ?? a.url }
    }),
    codeOwners: codeowners?.length ? matchCodeowners(codeowners, t.file) : undefined,
    a11y: t.a11y ?? undefined,
  }
}

export function runReport(slug: string, r: RunRow, tests: TestRow[], urlsByTest?: Map<string, Map<string, string[]>>, codeowners?: CodeownersRule[]): RunReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: r.id,
    projectId: slug,
    startedAt: r.startedAt.toISOString(),
    duration: r.duration,
    counts: r.counts,
    meta: { playwrightVersion: r.playwrightVersion ?? undefined, git: r.git ?? undefined, ci: r.ci ?? undefined, shards: r.shards ?? r.shardsTotal ?? undefined, ...shardState(r), ...incidentState(r) },
    tests: tests.map(t => toNormTest(t, urlsByTest?.get(t.id), codeowners)),
  }
}

export function findProject(organizationId: string, slug: string): Promise<ProjectRow | undefined> {
  return db.query.project.findFirst({
    where: and(eq(project.slug, slug), eq(project.organizationId, organizationId)),
  })
}

export function listProjects(organizationId: string): Promise<ProjectRow[]> {
  return db.query.project.findMany({
    where: eq(project.organizationId, organizationId),
    orderBy: desc(project.updatedAt),
  })
}

export function loadRun(projectId: string, runId: string): Promise<RunRow | undefined> {
  return db.query.run.findFirst({ where: and(eq(run.id, runId), eq(run.projectId, projectId)) })
}

export function loadLatestRun(projectId: string): Promise<RunRow | undefined> {
  return db.query.run.findFirst({ where: eq(run.projectId, projectId), orderBy: desc(run.startedAt) })
}

export function loadRunSummaries(p: ProjectRow, limit = MAX_DASHBOARD_RUNS): Promise<RunSummary[]> {
  return db.query.run
    .findMany({ where: eq(run.projectId, p.id), orderBy: desc(run.startedAt), limit })
    .then(runs => runs.map(r => runSummary(p.slug, r)))
}

function runWindow<T extends PgSelect>(runs: T, where?: SQL, size = MAX_DASHBOARD_RUNS) {
  return runs.where(and(eq(run.projectId, project.id), where)).orderBy(desc(run.startedAt), desc(run.id)).limit(size).as('w')
}

function runWindowOptions(scope: SQL) {
  const w = runWindow(db.select({ git: run.git, countsByTag: run.countsByTag }).from(run).$dynamic())
  const runs = db.select({ ...w._.selectedFields }).from(project).innerJoinLateral(w, sql`true`).where(scope)
  return db.execute<{ branches: string[], tags: string[] }>(sql`with w as (${runs})
    select array(select distinct git->>'branch' from w where git->>'branch' is not null) as branches, array(select distinct jsonb_object_keys(counts_by_tag) from w) as tags`)
}

function groupByProject<T extends { projectId: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const r of rows) {
    const list = out.get(r.projectId)
    if (list)
      list.push(r)
    else
      out.set(r.projectId, [r])
  }
  return out
}

export function loadOverview(organizationId: string, filter: { branch?: string, tag?: string } = {}): Promise<DashboardOverview> {
  return summarizeProjects(listProjects(organizationId), eq(project.organizationId, organizationId), filter)
}

export async function loadProjectSummary(p: ProjectRow): Promise<OverviewProject> {
  const { projects: [summary] } = await summarizeProjects([p], eq(project.id, p.id))
  return summary
}

async function summarizeProjects(projectRows: ProjectRow[] | Promise<ProjectRow[]>, scope: SQL, filter: { branch?: string, tag?: string } = {}): Promise<DashboardOverview> {
  const generatedAt = new Date().toISOString()
  const { branch, tag } = filter
  const inProjects = sql`${run.projectId} in (select ${project.id} from ${project} where ${scope})`
  const matching = and(branch ? sql`${run.git}->>'branch' = ${branch}` : undefined, tag ? sql`${run.countsByTag} ? ${tag}` : undefined)
  const trendWindow = runWindow(db
    .select({
      id: run.id,
      projectId: run.projectId,
      startedAt: run.startedAt,
      duration: run.duration,
      incident: run.incident,
      counts: (tag ? sql<Counts>`${run.countsByTag} -> ${tag}` : sql<Counts>`${run.counts}`).as('counts'),
    })
    .from(run)
    .$dynamic(), matching)
  const latestWindow = runWindow(db.select().from(run).$dynamic(), matching, HEALTH_WINDOW)

  const [projects, totals, windowRows, latestRows, options] = await Promise.all([
    projectRows,
    db.select({ projectId: run.projectId, n: count() }).from(run).where(and(inProjects, matching)).groupBy(run.projectId),
    db.select({ ...trendWindow._.selectedFields }).from(project).innerJoinLateral(trendWindow, sql`true`).where(scope),
    db.select({ ...latestWindow._.selectedFields }).from(project).innerJoinLateral(latestWindow, sql`true`).where(scope),
    runWindowOptions(scope).then(r => r.rows[0]),
  ])

  const runCount = new Map(totals.map(t => [t.projectId, t.n]))
  const windowByProject = groupByProject(windowRows)
  const latestByProject = groupByProject(latestRows)

  return {
    generatedAt,
    branches: (options?.branches ?? []).sort(),
    tags: (options?.tags ?? []).sort(),
    projects: projects.map((p) => {
      const points = trendOf((windowByProject.get(p.id) ?? []).map(r => ({
        runId: r.id,
        startedAt: r.startedAt.toISOString(),
        duration: r.duration,
        counts: r.counts,
        incident: r.incident ?? undefined,
      })))
      return {
        id: p.slug,
        name: p.name,
        description: p.description ?? undefined,
        runCount: runCount.get(p.id) ?? 0,
        runs: (latestByProject.get(p.id) ?? []).map(r => ({ ...runSummary(p.slug, r), counts: tag ? r.countsByTag[tag] : r.counts, countsByTag: {} })),
        trend: downsampleTrend(points).map(t => ({ passRate: t.passRate, ...(t.incident && { incident: t.incident }) })),
      }
    }),
  }
}

export const RUN_PAGE_SIZE = 25

export async function loadRunPage(p: ProjectRow, cursor: { before?: string, after?: string } = {}, limit = RUN_PAGE_SIZE): Promise<ProjectRunsPage> {
  const anchorId = cursor.after ?? cursor.before
  const anchor = anchorId ? await loadRun(p.id, anchorId) : undefined
  if (!anchor)
    return runPage(p, undefined, 'older', limit)
  const page = await runPage(p, anchor.id, cursor.after ? 'newer' : 'older', limit)
  return cursor.after && !page.newer ? runPage(p, undefined, 'older', limit) : page
}

async function runPage(p: ProjectRow, anchorId: string | undefined, direction: 'newer' | 'older', limit: number): Promise<ProjectRunsPage> {
  const key = sql`(${run.startedAt}, ${run.id})`
  const anchorKey = sql`(select ${run.startedAt}, ${run.id} from ${run} where ${run.id} = ${anchorId})`
  const rows = await db
    .select()
    .from(run)
    .where(and(eq(run.projectId, p.id), anchorId ? (direction === 'newer' ? sql`${key} > ${anchorKey}` : sql`${key} < ${anchorKey}`) : undefined))
    .orderBy(...(direction === 'newer' ? [asc(run.startedAt), asc(run.id)] : [desc(run.startedAt), desc(run.id)]))
    .limit(limit + 1)
  const more = rows.length > limit
  const page = rows.slice(0, limit)
  if (direction === 'newer')
    page.reverse()
  const first = page[0]?.id
  const last = page.at(-1)?.id
  return {
    runs: page.map(r => runSummary(p.slug, r)),
    newer: direction === 'newer' ? (more ? first : undefined) : (anchorId ? first : undefined),
    older: direction === 'newer' ? last : (more ? last : undefined),
  }
}

// Artifact URLs are resolved (signed local / presigned S3) at read time, not stored.
export async function loadRunReport(p: ProjectRow, r: RunRow): Promise<RunReport> {
  const tests = await db.query.test.findMany({ where: eq(test.runId, r.id), orderBy: asc(test.file) })
  const arts = await db.query.artifact.findMany({ where: eq(artifact.runId, r.id), orderBy: asc(artifact.createdAt) })

  const urlsByTest = new Map<string, Map<string, string[]>>()
  for (const a of arts) {
    if (!a.testId)
      continue
    const m = urlsByTest.get(a.testId) ?? new Map<string, string[]>()
    m.set(a.name, [...(m.get(a.name) ?? []), await storage.url(a.storageKey)])
    urlsByTest.set(a.testId, m)
  }

  return runReport(p.slug, r, tests, urlsByTest, parseCodeowners(p.codeownersText))
}

// One test's attachments in one run, with signed urls: what the test history page loads when
// someone opens a failed screenshot assertion. undefined = no such test in that run of the project.
export async function loadTestAttachments(p: ProjectRow, runId: string, testKey: string): Promise<NormTest['attachments'] | undefined> {
  const t = await db.query.test.findFirst({ where: and(eq(test.projectId, p.id), eq(test.runId, runId), eq(test.testKey, testKey)) })
  if (!t)
    return undefined
  const arts = await db.query.artifact.findMany({ where: eq(artifact.testId, t.id), orderBy: asc(artifact.createdAt) })
  const urls = new Map<string, string[]>()
  for (const a of arts)
    urls.set(a.name, [...(urls.get(a.name) ?? []), await storage.url(a.storageKey)])
  return toNormTest(t, urls).attachments
}

// The newest runs of a project: the window every history reads.
function windowRuns(projectId: string): Promise<RunRow[]> {
  return db.query.run.findMany({ where: eq(run.projectId, projectId), orderBy: desc(run.startedAt), limit: MAX_DASHBOARD_RUNS })
}

// Just what a history point and its test need, never the whole row: a project's window is
// tests x runs rows, and annotations / errors / attachments are the heavy columns.
interface PointRow {
  runId: string
  testKey: string
  title: string
  titlePath: string[]
  file: string
  projectName: string
  status: NormTest['status']
  duration: number
  retries: number
  errorMessage: string | null
  attachments: NormTest['attachments']
  annotations: NormTest['annotations'] | null
  a11y: NormTest['a11y'] | null
}

const pointColumns = sql`t.run_id as "runId", t.test_key as "testKey", t.title, t.title_path as "titlePath", t.file,
  t.project_name as "projectName", t.status, t.duration, t.retries, t.errors->0->>'message' as "errorMessage", t.attachments, t.a11y`

// Rows -> run reports for the core history builders, which only read these fields.
function pointReports(slug: string, runs: RunRow[], rows: PointRow[], codeowners: CodeownersRule[]): RunReport[] {
  const owners = new Map<string, string[] | undefined>()
  const byRun = new Map<string, NormTest[]>()
  for (const r of rows) {
    if (!owners.has(r.file))
      owners.set(r.file, codeowners.length ? matchCodeowners(codeowners, r.file) : undefined)
    const tests = byRun.get(r.runId) ?? []
    tests.push({
      testKey: r.testKey,
      title: r.title,
      titlePath: r.titlePath,
      file: r.file,
      line: 0,
      column: 0,
      projectName: r.projectName,
      status: r.status,
      ok: r.status !== 'unexpected',
      duration: r.duration,
      retries: r.retries,
      tags: [],
      annotations: r.annotations ?? [],
      errors: r.errorMessage == null ? [] : [{ message: r.errorMessage }],
      attachments: r.attachments,
      codeOwners: owners.get(r.file),
      a11y: r.a11y ?? undefined,
    })
    byRun.set(r.runId, tests)
  }
  return runs.filter(r => byRun.has(r.id)).map(r => ({ ...runReport(slug, r, []), tests: byRun.get(r.id)! }))
}

// Failure clusters read the failing occurrences only, with their first error.
async function windowClusters(slug: string, runs: RunRow[]) {
  const ids = runs.map(r => r.id)
  const rows = await db.execute<{ runId: string, testKey: string, file: string, status: NormTest['status'], error: NormError }>(sql`
    select t.run_id as "runId", t.test_key as "testKey", t.file, t.status, t.errors->0 as error
    from test t
    where t.run_id in (${sql.join(ids.map(id => sql`${id}`), sql`, `)})
      and t.status in ('unexpected', 'flaky') and jsonb_array_length(t.errors) > 0`)
  const byRun = new Map<string, NormTest[]>()
  for (const r of rows.rows) {
    const tests = byRun.get(r.runId) ?? []
    tests.push({ testKey: r.testKey, file: r.file, status: r.status, errors: [r.error] } as NormTest)
    byRun.set(r.runId, tests)
  }
  return buildFailureClusters(runs.filter(r => byRun.has(r.id)).map(r => ({ ...runReport(slug, r, []), tests: byRun.get(r.id)! })))
}

function projectEntry(p: ProjectRow, runs: RunRow[]): ProjectEntry {
  return { id: p.slug, name: p.name, runs: runs.map(r => runSummary(p.slug, r)) }
}

const storyFilter = (alias: string) => sql.raw(`${alias}.annotations @> '[{"type": "kinora:story"}]'`)

// Every test of the project over its newest runs, for the list pages. Each history carries counts
// and rates over the whole window but only the points its health reads (see trimPoints), and
// Postgres does the picking: loading every row put a 3,000-test project at ~2 GB of server memory
// and ~150 MB of JSON per page load. `componentsOnly`: just the tests that mount stories, without
// failure clusters, for the Components page.
export async function loadProjectHistory(p: ProjectRow, opts: { componentsOnly?: boolean } = {}): Promise<ProjectHistory> {
  const window = await windowRuns(p.id)
  const entry = projectEntry(p, window)
  const runs = countedRuns(window)
  if (!runs.length)
    return { project: entry, histories: [], clusters: [] }
  const ids = sql.join(runs.map(r => sql`${r.id}`), sql`, `)

  // Stories: the latest run that mounted any, wherever it sits in the window.
  const storyRows = await db.execute<{ testKey: string, annotations: NormTest['annotations'] }>(sql`
    select distinct on (t.test_key) t.test_key as "testKey", t.annotations
    from test t join run r on r.id = t.run_id
    where t.run_id in (${ids}) and ${storyFilter('t')}
    order by t.test_key, r.started_at desc`)
  if (opts.componentsOnly && !storyRows.rows.length)
    return { project: entry, histories: [], clusters: [] }
  const onlyStories = opts.componentsOnly
    ? sql`and t.test_key in (select s.test_key from test s where s.run_id in (${ids}) and ${storyFilter('s')})`
    : sql``

  // Per test, newest first: its rank among all and among executed runs, the newest run it did not
  // fail (the end of a failing streak), and its counts. A superset of trimPoints, which then trims.
  const rows = await db.execute<PointRow & StatusCounts & Record<string, unknown>>(sql`
    with ranked as (
      select t.id, t.status,
        row_number() over newest as raw_rank,
        count(*) filter (where t.status <> 'skipped') over newest as exec_rank,
        max(r.started_at) filter (where t.status not in ('unexpected', 'skipped')) over key as last_ok_at,
        r.started_at,
        count(*) filter (where t.status = 'expected') over key as passed,
        count(*) filter (where t.status = 'unexpected') over key as failed,
        count(*) filter (where t.status = 'flaky') over key as flaky,
        count(*) filter (where t.status = 'skipped') over key as skipped
      from test t join run r on r.id = t.run_id
      where t.run_id in (${ids}) ${onlyStories}
      window key as (partition by t.test_key), newest as (partition by t.test_key order by r.started_at desc)
    )
    select ${pointColumns}, ranked.passed::int, ranked.failed::int, ranked.flaky::int, ranked.skipped::int
    from ranked join test t on t.id = ranked.id
    where ranked.raw_rank <= ${HEALTH_WINDOW}
      or (ranked.status <> 'skipped' and (ranked.exec_rank <= ${HEALTH_WINDOW} or ranked.started_at > coalesce(ranked.last_ok_at, '-infinity')))`)

  const totals = new Map<string, StatusCounts>()
  for (const r of rows.rows)
    totals.set(r.testKey, { passed: r.passed, failed: r.failed, flaky: r.flaky, skipped: r.skipped })
  const stories = new Map(storyRows.rows.map(r => [r.testKey, storiesOf(r)]))

  const histories = buildTestHistories(pointReports(p.slug, runs, rows.rows, parseCodeowners(p.codeownersText)))
  for (const h of histories) {
    h.points = trimPoints(h.points)
    applyTotals(h, totals.get(h.testKey)!)
    const s = stories.get(h.testKey)
    if (s?.length)
      h.stories = s
  }
  const clusters = opts.componentsOnly ? [] : await windowClusters(p.slug, runs)
  return { project: entry, histories, clusters }
}

async function testHistoryOver(p: ProjectRow, runs: RunRow[], testKey: string): Promise<TestHistory | undefined> {
  if (!runs.length)
    return undefined
  const rows = await db.execute<PointRow & Record<string, unknown>>(sql`
    select ${pointColumns}, t.annotations
    from test t
    where t.project_id = ${p.id} and t.test_key = ${testKey}
      and t.run_id in (${sql.join(runs.map(r => sql`${r.id}`), sql`, `)})`)
  return buildTestHistories(pointReports(p.slug, runs, rows.rows, parseCodeowners(p.codeownersText)))[0]
}

// One test over the project's newest runs, every point: agents reading one test's history.
export async function loadTestHistory(p: ProjectRow, testKey: string): Promise<TestHistory | undefined> {
  return testHistoryOver(p, countedRuns(await windowRuns(p.id)), testKey)
}

export interface TestHistoryPage {
  project: ProjectEntry
  history: TestHistory | null
  // The failure clusters this test is part of, and the titles of the tests they share.
  clusters: FailureCluster[]
  titles: Record<string, Pick<TestHistory, 'title' | 'titlePath'>>
}

// What the test history page shows: the test with every point, plus what it needs of the project
// (its runs, the clusters this test is in), without the history of every other test.
export async function loadTestHistoryPage(p: ProjectRow, testKey: string): Promise<TestHistoryPage> {
  const window = await windowRuns(p.id)
  const runs = countedRuns(window)
  const history = (await testHistoryOver(p, runs, testKey)) ?? null
  const clusters = history && (history.failed || history.flaky)
    ? (await windowClusters(p.slug, runs)).filter(c => c.testKeys.includes(testKey))
    : []
  const keys = [...new Set(clusters.flatMap(c => c.testKeys))]
  const titleRows = keys.length
    ? await db.execute<{ testKey: string, title: string, titlePath: string[] }>(sql`
        select distinct on (t.test_key) t.test_key as "testKey", t.title, t.title_path as "titlePath"
        from test t
        where t.project_id = ${p.id} and t.test_key in (${sql.join(keys.map(k => sql`${k}`), sql`, `)})
        order by t.test_key, t.created_at desc`)
    : { rows: [] }
  return {
    project: projectEntry(p, window),
    history,
    clusters,
    titles: Object.fromEntries(titleRows.rows.map(r => [r.testKey, { title: r.title, titlePath: r.titlePath }])),
  }
}

// Tests of a workspace whose file, title path or project contains every word of the query, one
// hit per test. `preferSlug` lists that project's hits first, for a search started from one of its pages.
export async function searchTests(organizationId: string, query: string, preferSlug?: string): Promise<TestSearchHit[]> {
  const terms = query.split(/\s+/).filter(Boolean).slice(0, MAX_SEARCH_TERMS)
  if (!terms.length)
    return []

  const recentRun = db.$with('recent_run').as(
    db.select({
      id: run.id,
      startedAt: run.startedAt,
      slug: project.slug,
      projectName: project.name,
      position: sql<number>`row_number() over (partition by ${run.projectId} order by ${run.startedAt} desc)`.as('position'),
    })
      .from(run)
      .innerJoin(project, eq(project.id, run.projectId))
      .where(eq(project.organizationId, organizationId)),
  )

  // titlePath starts with the file and ends with the title, so it covers suites too. The project
  // is searched as well, to narrow a query down with its name ("checkout web").
  const haystack = sql`(${test.file} || ' ' || ${test.titlePath}::text || ' ' || ${recentRun.projectName} || ' ' || ${recentRun.slug})`
  const match = db.with(recentRun)
    .selectDistinctOn([recentRun.slug, test.testKey], {
      projectId: recentRun.slug,
      projectName: recentRun.projectName,
      testKey: test.testKey,
      title: test.title,
      titlePath: test.titlePath,
      file: test.file,
      status: test.status,
      runId: test.runId,
      startedAt: recentRun.startedAt,
    })
    .from(test)
    .innerJoin(recentRun, eq(test.runId, recentRun.id))
    .where(and(
      lte(recentRun.position, SEARCH_RUN_WINDOW),
      // LIKE wildcards in the query are matched literally.
      ...terms.map(term => ilike(haystack, `%${term.replace(/[\\%_]/g, '\\$&')}%`)),
    ))
    .orderBy(recentRun.slug, test.testKey, desc(recentRun.startedAt))
    .as('match')

  const rows = await db.select().from(match).orderBy(
    ...(preferSlug ? [desc(eq(match.projectId, preferSlug))] : []),
    desc(match.startedAt),
    asc(match.title),
  ).limit(MAX_SEARCH_RESULTS)
  return rows.map(r => ({ ...r, startedAt: r.startedAt.toISOString() }))
}
