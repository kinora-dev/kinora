import type { Counts } from '@kinora/core'
import type { SQL } from 'drizzle-orm'
import { isSlower, RECENT_DURATION_SAMPLES } from '@kinora/core'
import { and, eq, gte, isNotNull, isNull, sql } from 'drizzle-orm'
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
}

export const SLOW_TESTS_LIMIT = 15

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
  recentMedian: number // over its newest RECENT_DURATION_SAMPLES passing results
  earlierMedian: number | null // over the ones before, when there are as many
  slower: boolean
}

export interface ProjectAnalytics {
  days: AnalyticsRange
  bucket: AnalyticsBucket
  branches: string[] // branches with a run in the range, for the filter
  outcomes: OutcomeBucket[] // only buckets that have runs, oldest first
  slowTests: SlowTest[] // slowest first, at most SLOW_TESTS_LIMIT
  measuredTests: number // tests with a passing result in the range, of which slowTests are the top
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
  recentMedian: number
  earlierMedian: number | null
  measured: number
}

async function loadSlowTests(projectId: string, runFilter: SQL): Promise<Pick<ProjectAnalytics, 'slowTests' | 'measuredTests'>> {
  const recent = RECENT_DURATION_SAMPLES
  const { rows } = await db.execute<SlowTestRow>(sql`
    with samples as (
      select t.test_key, t.duration,
        row_number() over (partition by t.test_key order by ${run.startedAt} desc, ${run.id} desc) as rn
      from test t join ${run} on ${run.id} = t.run_id
      where ${runFilter} and t.status = 'expected'
    ), stats as (
      select test_key, count(*)::int as samples,
        percentile_cont(0.5) within group (order by duration) as median,
        percentile_cont(0.9) within group (order by duration) as p90,
        percentile_cont(0.5) within group (order by duration) filter (where rn <= ${recent}) as recent,
        percentile_cont(0.5) within group (order by duration) filter (where rn > ${recent}) as earlier,
        count(*) filter (where rn > ${recent}) as earlier_samples
      from samples group by test_key
    )
    select test_key as "testKey", samples, round(median)::int as median, round(p90)::int as p90,
      coalesce(median / nullif(sum(median) over (), 0), 0)::float8 as share,
      round(recent)::int as "recentMedian",
      case when earlier_samples >= ${recent} then round(earlier)::int end as "earlierMedian",
      (count(*) over ())::int as measured
    from stats
    order by median desc, test_key
    limit ${SLOW_TESTS_LIMIT}`)
  if (!rows.length)
    return { slowTests: [], measuredTests: 0 }

  const titles = await db.execute<Pick<SlowTest, 'testKey' | 'title' | 'titlePath' | 'file' | 'projectName'> & Record<string, unknown>>(sql`
    select distinct on (t.test_key) t.test_key as "testKey", t.title, t.title_path as "titlePath", t.file, t.project_name as "projectName"
    from test t
    where t.project_id = ${projectId} and t.test_key in (${sql.join(rows.map(r => sql`${r.testKey}`), sql`, `)})
    order by t.test_key, t.created_at desc`)
  const byKey = new Map(titles.rows.map(t => [t.testKey, t]))

  return {
    measuredTests: rows[0]!.measured,
    slowTests: rows.map(({ measured: _, ...r }) => {
      const t = byKey.get(r.testKey)!
      return { ...r, title: t.title, titlePath: t.titlePath, file: t.file, projectName: t.projectName, slower: isSlower(r.recentMedian, r.earlierMedian) }
    }),
  }
}
