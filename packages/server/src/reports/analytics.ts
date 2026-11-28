import type { Counts } from '@kinora/core'
import type { SQL } from 'drizzle-orm'
import { isSlower, RECENT_DURATION_RUNS } from '@kinora/core'
import { and, desc, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'
import { db } from '../db'
import { run } from '../db/schemas/index'

// Project analytics: trends over a longer range than the per-test pages (which read the newest
// HEALTH_WINDOW runs), aggregated in SQL so a long-lived project never loads its runs into memory.

const DAY = 86_400_000

export const ANALYTICS_RANGES = [30, 90] as const
export type AnalyticsRange = typeof ANALYTICS_RANGES[number]
export type AnalyticsBucket = 'day' | 'week'

// Test outcomes summed over every run started in one bucket.
export interface OutcomeBucket {
  date: string // YYYY-MM-DD in the requested time zone, first day of the bucket (a Monday per week)
  runs: number
  expected: number
  flaky: number
  unexpected: number
  skipped: number
  // Runs flagged as environment incidents: still counted here, but they explain a dip.
  incidents: number
  // The same results without the incident runs, which say nothing about the tests: what the
  // flaky and failure rates are judged on.
  countedExpected: number
  countedFlaky: number
  countedUnexpected: number
  // How long a run took (ms), over the runs that ran the whole suite; null without one.
  avgDuration: number | null
  p90Duration: number | null
}

export const SLOW_TESTS_LIMIT = 15
// The newest runs of the range the slowest tests are timed on: plenty for a median, and a busy
// project (thousands of runs a month) costs no more than a quiet one.
export const SLOW_TESTS_RUNS = 50

// One of the slowest tests of the range, timed on its passing results only: a failed or flaky
// result sums its retries and waits out timeouts.
export interface SlowTest {
  testKey: string
  title: string
  titlePath: string[]
  file: string
  projectName: string
  samples: number
  median: number // ms
  p90: number // ms
  share: number // its median over the sum of every measured test's: its part of the suite's time
  recentMedian: number | null // over its passes in the newest RECENT_DURATION_RUNS runs, when there are enough
  earlierMedian: number | null // over its passes in the runs before them, when there are enough
  slower: boolean
}

export interface ProjectAnalytics {
  days: AnalyticsRange
  bucket: AnalyticsBucket
  branches: string[] // branches with a run in the range, for the filter
  outcomes: OutcomeBucket[] // only buckets that have runs, oldest first
  slowTests: SlowTest[] // slowest first, at most SLOW_TESTS_LIMIT
  measuredTests: number // tests with a passing result in the timed runs, of which slowTests are the top
  timedRuns: number // runs the slowest tests are timed on, at most SLOW_TESTS_RUNS
}

// 90 days per day would be too many points to read, so the longer range goes per week.
export function bucketFor(days: AnalyticsRange): AnalyticsBucket {
  return days > 30 ? 'week' : 'day'
}

// IANA name only (`Europe/Paris`, `UTC`): it is inlined in SQL, so nothing else may get through.
export function isTimeZone(tz: string): boolean {
  if (!/^[A-Z][\w+-]*(?:\/[\w+-]+)*$/i.test(tz))
    return false
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz }).format()
    return true
  }
  catch {
    return false
  }
}

// Postgres reads the system tzdata, and recent Debian ones ship without the legacy links that
// browsers still report (`Asia/Calcutta`, `Europe/Kiev`), so such a name maps to the one Postgres
// knows for the same zone. UTC when there is none: days a few hours off beat a failed page.
let postgresZones: Promise<string[]> | undefined
const resolvedZones = new Map<string, string>()

async function postgresTimeZone(tz: string): Promise<string> {
  const cached = resolvedZones.get(tz)
  if (cached)
    return cached
  postgresZones ??= db.execute<{ name: string }>(sql`select name from pg_timezone_names`)
    .then(r => r.rows.map(row => row.name))
    .catch((error) => {
      postgresZones = undefined
      throw error
    })
  const names = await postgresZones
  let resolved = 'UTC'
  if (names.includes(tz)) {
    resolved = tz
  }
  else {
    const now = Temporal.Now.instant()
    const zoned = now.toZonedDateTimeISO(tz)
    resolved = names.find((name) => {
      try {
        return zoned.equals(now.toZonedDateTimeISO(name))
      }
      catch {
        return false
      }
    }) ?? resolved
  }
  resolvedZones.set(tz, resolved)
  return resolved
}

// `timeZone` is the viewer's: a run at 00:30 in Paris belongs to that day, not to the UTC one before.
export async function loadProjectAnalytics(projectId: string, days: AnalyticsRange, branch?: string, viewerTimeZone = 'UTC'): Promise<ProjectAnalytics> {
  if (!isTimeZone(viewerTimeZone))
    throw new Error(`Invalid time zone: ${viewerTimeZone}`)
  const timeZone = await postgresTimeZone(viewerTimeZone)
  const bucket = bucketFor(days)
  const since = new Date(Date.now() - days * DAY)
  const inRange = and(eq(run.projectId, projectId), gte(run.startedAt, since))
  // Inlined, not bind parameters: the select and the group by must be the same expression.
  // started_at is a UTC timestamp without zone, hence the double AT TIME ZONE.
  const local = sql`(${run.startedAt} AT TIME ZONE 'UTC') AT TIME ZONE ${sql.raw(`'${timeZone}'`)}`
  const start = sql`date_trunc(${sql.raw(`'${bucket}'`)}, ${local})`
  const total = (key: keyof Counts) => sql<number>`coalesce(sum((${run.counts}->>${sql.raw(`'${key}'`)})::int), 0)::int`
  const counted = (key: keyof Counts) => sql<number>`coalesce(sum((${run.counts}->>${sql.raw(`'${key}'`)})::int) filter (where ${run.incident} is null), 0)::int`
  const branchOf = sql<string>`${run.git}->>'branch'`
  // A run cut short, one missing shards and an environment incident end early or wait on a broken
  // app: their time says nothing about the suite's. A grouped run's duration spans all its shards.
  const timed = sql`${run.status} = 'complete' and ${run.interruption} is null and ${run.incident} is null`

  const [outcomes, branches, slow] = await Promise.all([
    db
      .select({
        date: sql<string>`to_char(${start}, 'YYYY-MM-DD')`,
        runs: sql<number>`count(*)::int`,
        expected: total('expected'),
        flaky: total('flaky'),
        unexpected: total('unexpected'),
        skipped: total('skipped'),
        incidents: sql<number>`(count(*) filter (where ${run.incident} is not null))::int`,
        countedExpected: counted('expected'),
        countedFlaky: counted('flaky'),
        countedUnexpected: counted('unexpected'),
        avgDuration: sql<number | null>`round(avg(${run.duration}) filter (where ${timed}))::int`,
        p90Duration: sql<number | null>`round(percentile_cont(0.9) within group (order by ${run.duration}) filter (where ${timed}))::int`,
      })
      .from(run)
      .where(and(inRange, branch ? eq(branchOf, branch) : undefined))
      .groupBy(start)
      .orderBy(start),
    db
      .selectDistinct({ name: branchOf })
      .from(run)
      .where(and(inRange, isNotNull(branchOf)))
      .orderBy(branchOf),
    // An incident run's timings come from a broken environment.
    loadSlowTests(projectId, and(inRange, isNull(run.incident), branch ? eq(branchOf, branch) : undefined)!),
  ])

  return { days, bucket, branches: branches.map(b => b.name), outcomes, ...slow }
}

interface SlowTestRow extends Record<string, unknown> {
  testKey: string
  samples: number
  median: number
  p90: number
  share: number
  recentMedian: number | null
  earlierMedian: number | null
  measured: number
}

// Passes a median needs before it is compared: one slow pass among the newest runs is not a trend.
const MIN_RECENT_PASSES = 3
const MIN_EARLIER_PASSES = 5

async function loadSlowTests(projectId: string, runFilter: SQL): Promise<Pick<ProjectAnalytics, 'slowTests' | 'measuredTests' | 'timedRuns'>> {
  const runs = await db.select({ id: run.id }).from(run).where(runFilter).orderBy(desc(run.startedAt), desc(run.id)).limit(SLOW_TESTS_RUNS)
  if (!runs.length)
    return { slowTests: [], measuredTests: 0, timedRuns: 0 }
  // Literal ids, not a join on run: Postgres then reads the test rows through their run_id index
  // instead of scanning the whole table.
  const ids = (list: typeof runs) => sql.join(list.map(r => sql`${r.id}`), sql`, `)
  const recent = ids(runs.slice(0, RECENT_DURATION_RUNS))
  // Grouped by the byte order of the key ("C"): sorting it by the database's locale was half the cost.
  const { rows } = await db.execute<SlowTestRow>(sql`
    with stats as (
      select t.test_key collate "C" as test_key, count(*)::int as samples,
        percentile_cont(0.5) within group (order by t.duration) as median,
        percentile_cont(0.9) within group (order by t.duration) as p90,
        percentile_cont(0.5) within group (order by t.duration) filter (where t.run_id in (${recent})) as recent,
        count(*) filter (where t.run_id in (${recent})) as recent_samples,
        percentile_cont(0.5) within group (order by t.duration) filter (where t.run_id not in (${recent})) as earlier,
        count(*) filter (where t.run_id not in (${recent})) as earlier_samples
      from test t
      where t.run_id in (${ids(runs)}) and t.status = 'expected'
      group by t.test_key collate "C"
    )
    select test_key as "testKey", samples, round(median)::int as median, round(p90)::int as p90,
      coalesce(median / nullif(sum(median) over (), 0), 0)::float8 as share,
      case when recent_samples >= ${MIN_RECENT_PASSES} then round(recent)::int end as "recentMedian",
      case when earlier_samples >= ${MIN_EARLIER_PASSES} then round(earlier)::int end as "earlierMedian",
      (count(*) over ())::int as measured
    from stats
    order by median desc, test_key
    limit ${SLOW_TESTS_LIMIT}`)
  if (!rows.length)
    return { slowTests: [], measuredTests: 0, timedRuns: runs.length }

  const titles = await db.execute<Pick<SlowTest, 'testKey' | 'title' | 'titlePath' | 'file' | 'projectName'> & Record<string, unknown>>(sql`
    select distinct on (t.test_key) t.test_key as "testKey", t.title, t.title_path as "titlePath", t.file, t.project_name as "projectName"
    from test t
    where t.project_id = ${projectId} and t.test_key in (${sql.join(rows.map(r => sql`${r.testKey}`), sql`, `)})
    order by t.test_key, t.created_at desc`)
  const byKey = new Map(titles.rows.map(t => [t.testKey, t]))

  return {
    timedRuns: runs.length,
    measuredTests: rows[0]!.measured,
    slowTests: rows.map(({ measured: _, ...r }) => {
      const t = byKey.get(r.testKey)!
      return { ...r, title: t.title, titlePath: t.titlePath, file: t.file, projectName: t.projectName, slower: isSlower(r.recentMedian, r.earlierMedian) }
    }),
  }
}
