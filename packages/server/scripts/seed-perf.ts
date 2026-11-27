import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { and, eq, inArray, like, sql } from 'drizzle-orm'
import { db } from '../src/db'
import { member, project, user as userTable } from '../src/db/schemas/index'
import { env } from '../src/lib/env'
import { logger } from '../src/lib/logger'

// Large projects for measuring the heavy reads (project history, the run page, failure clusters)
// at a size real customers reach. Rows are generated in SQL, not ingested run by run: a 3,000 x
// 500 project is 1.5M test rows. Seeds into the demo account's workspace (run `pnpm db:seed`
// first), as `perf-*` projects that each run drops and recreates.
//
//   pnpm db:seed:perf                      every profile at full size
//   pnpm db:seed:perf --scale 0.1          a tenth of the tests, for a quick pass
//   pnpm db:seed:perf --only perf-large    some profiles (comma-separated slugs)

const EMAIL = 'demo@kinora.dev'

interface Profile {
  slug: string
  name: string
  tests: number
  runs: number
  // Every Nth test is always skipped / always failing (0 = none).
  skipEvery: number
  chronicEvery: number
  // A test fails or flakes in a run when a hash of (test, run) lands on 0 modulo this (0 = never).
  failMod: number
  flakyMod: number
  // Distinct error messages failures draw from: the number of failure clusters.
  errorKinds: number
}

const PROFILES: Profile[] = [
  // A big healthy suite with a long history: the project history and Tests page worst case.
  { slug: 'perf-large', name: 'Perf: large suite', tests: 3000, runs: 500, skipEvery: 0, chronicEvery: 300, failMod: 997, flakyMod: 499, errorKinds: 12 },
  // A third of the suite skipped for good (test.skip / fixme), the rest stable.
  { slug: 'perf-skipped', name: 'Perf: mostly skipped', tests: 2000, runs: 300, skipEvery: 3, chronicEvery: 0, failMod: 1999, flakyMod: 0, errorKinds: 4 },
  // A quarter of the tests failing every run: the failure clusters read every occurrence.
  { slug: 'perf-failing', name: 'Perf: chronic failures', tests: 2000, runs: 200, skipEvery: 0, chronicEvery: 4, failMod: 97, flakyMod: 193, errorKinds: 40 },
  // A busy CI (a run every hour for ~5 months): far more runs than the MAX_DASHBOARD_RUNS window, so
  // the paged run list and the 90 day analytics read past it.
  { slug: 'perf-busy', name: 'Perf: busy CI', tests: 200, runs: 4000, skipEvery: 0, chronicEvery: 0, failMod: 499, flakyMod: 97, errorKinds: 6 },
  // One huge run at the ingest contract's limit (MAX_TESTS_PER_RUN): the run page and run compare.
  { slug: 'perf-huge-run', name: 'Perf: one huge run', tests: 50_000, runs: 2, skipEvery: 0, chronicEvery: 50, failMod: 0, flakyMod: 0, errorKinds: 20 },
]

const FILES_PER_PROFILE = 150

async function seedProfile(orgId: string, p: Profile): Promise<void> {
  const started = Date.now()
  const [row] = await db.insert(project).values({ id: randomUUID(), organizationId: orgId, slug: p.slug, name: p.name }).returning({ id: project.id })
  const projectId = row!.id
  const n = (v: number) => sql.raw(String(Math.round(v)))

  // One run per hour, the newest an hour ago; each run on its own commit.
  await db.execute(sql`
    insert into run (id, project_id, started_at, duration, counts, git)
    select md5(${projectId} || '-' || r)::uuid::text, ${projectId}, now() - ((${n(p.runs)} - r + 1) || ' hours')::interval, 0,
      '{"total":0,"expected":0,"unexpected":0,"flaky":0,"skipped":0}'::jsonb,
      jsonb_build_object('branch', 'main', 'sha', md5('perf-' || r))
    from generate_series(1, ${n(p.runs)}) as runs(r)`)

  const skipped = p.skipEvery ? sql`t % ${n(p.skipEvery)} = 0` : sql`false`
  const chronic = p.chronicEvery ? sql`t % ${n(p.chronicEvery)} = 1` : sql`false`
  const fails = p.failMod ? sql`(t * 13 + r * 7) % ${n(p.failMod)} = 0` : sql`false`
  const flakes = p.flakyMod ? sql`(t * 31 + r * 17) % ${n(p.flakyMod)} = 0` : sql`false`
  await db.execute(sql`
    insert into test (id, run_id, project_id, test_key, title, title_path, file, line, "column", project_name,
      status, ok, duration, retries, tags, annotations, errors, attachments)
    select gen_random_uuid()::text, md5(${projectId} || '-' || r)::uuid::text, ${projectId}, 'perf-' || t, title,
      jsonb_build_array(file, 'suite ' || (t % 20), title), file, 10 + t % 200, 5, 'chromium',
      status, status <> 'unexpected', 200 + (t * 37 + r * 11) % 3000, case when status = 'flaky' then 1 else 0 end,
      '[]'::jsonb, '[]'::jsonb,
      case when status in ('unexpected', 'flaky') then jsonb_build_array(jsonb_build_object(
        'message', 'Error: expect(received).toBe(expected) - case ' || (t % ${n(p.errorKinds)}),
        'stack', 'Error: expect(received).toBe(expected)' || chr(10) || '    at ' || file || ':' || (10 + t % 200) || ':5'))
      else '[]'::jsonb end,
      '[]'::jsonb
    from (
      select t, r, 'tests/area-' || (t % ${n(FILES_PER_PROFILE)}) || '/feature.spec.ts' as file, 'case ' || t as title,
        case
          when ${skipped} then 'skipped'
          when ${chronic} or ${fails} then 'unexpected'
          when ${flakes} then 'flaky'
          else 'expected'
        end as status
      from generate_series(1, ${n(p.runs)}) as runs(r), generate_series(1, ${n(p.tests)}) as tests(t)
    ) g`)

  // Run counts and durations, as the ingest would have recorded them.
  await db.execute(sql`
    update run set
      counts = c.counts,
      duration = c.duration
    from (
      select run_id, sum(duration)::int / 8 as duration, jsonb_build_object(
        'total', count(*),
        'expected', count(*) filter (where status = 'expected'),
        'unexpected', count(*) filter (where status = 'unexpected'),
        'flaky', count(*) filter (where status = 'flaky'),
        'skipped', count(*) filter (where status = 'skipped')) as counts
      from test where project_id = ${projectId} group by run_id
    ) c
    where run.id = c.run_id`)

  logger.info(`seeded ${p.slug}: ${p.tests.toLocaleString('en-US')} tests x ${p.runs} runs in ${((Date.now() - started) / 1000).toFixed(1)}s`)
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    logger.error('Refusing to seed perf data in production.')
    process.exit(1)
  }

  const { values } = parseArgs({ options: { scale: { type: 'string', default: '1' }, only: { type: 'string' } } })
  const scale = Number(values.scale)
  if (!(scale > 0)) {
    logger.error(`--scale must be a positive number, got ${values.scale}`)
    process.exit(1)
  }
  const only = values.only?.split(',').map(s => s.trim())
  const profiles = PROFILES
    .filter(p => !only || only.includes(p.slug))
    .map(p => ({ ...p, tests: Math.max(1, Math.round(p.tests * scale)) }))
  if (!profiles.length) {
    logger.error(`No profile matches --only ${values.only}. Profiles: ${PROFILES.map(p => p.slug).join(', ')}`)
    process.exit(1)
  }

  const demo = await db.query.user.findFirst({ where: eq(userTable.email, EMAIL), columns: { id: true } })
  if (!demo) {
    logger.error(`No ${EMAIL} account: run \`pnpm db:seed\` first.`)
    process.exit(1)
  }
  const owned = await db.query.member.findFirst({ where: and(eq(member.userId, demo.id), eq(member.role, 'owner')), columns: { organizationId: true } })
  const orgId = owned!.organizationId

  // Rerunnable: drop the previous perf projects (runs and tests cascade), only the selected ones with --only.
  await db.delete(project).where(and(eq(project.organizationId, orgId), only ? inArray(project.slug, profiles.map(p => p.slug)) : like(project.slug, 'perf-%')))
  for (const p of profiles)
    await seedProfile(orgId, p)
  // Fresh statistics, or the planner reads the new millions of rows as an empty table.
  await db.execute(sql`analyze run, test`)

  logger.info('-'.repeat(40))
  logger.info(`Login: ${EMAIL} / password123`)
  for (const p of profiles)
    logger.info(`${p.name}: ${env.WEB_ORIGIN}/projects/${p.slug}`)
  logger.info('-'.repeat(40))
  process.exit(0)
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
