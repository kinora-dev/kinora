import process from 'node:process'
import { parseArgs } from 'node:util'
import { and, eq, inArray, like } from 'drizzle-orm'
import { db } from '../src/db'
import { member, project, test, user as userTable } from '../src/db/schemas/index'
import { env } from '../src/lib/env'
import { logger } from '../src/lib/logger'
import { loadProjectAnalytics } from '../src/reports/analytics'
import { loadLatestRun, loadOverview, loadProjectClusters, loadProjectHistory, loadRunPage, loadRunReport, loadTestHistoryPage } from '../src/reports/queries'
import { computeRegression, testsOfRun } from '../src/reports/regression'

// Times the heavy dashboard reads against the local database, with the size of what each returns,
// to measure a change to a query before and after. Reads the demo workspace's `perf-*` projects
// (`pnpm db:seed:perf`) unless --only names projects.
//
//   pnpm bench:reads                          every perf-* project, 3 calls per read
//   pnpm bench:reads --only perf-large,web-app --repeat 5

const EMAIL = 'demo@kinora.dev'

async function time(label: string, repeat: number, fn: () => Promise<unknown>): Promise<void> {
  await fn() // warm the plan and page caches, so the numbers compare across runs
  const runs: number[] = []
  let size = 0
  for (let i = 0; i < repeat; i++) {
    const started = performance.now()
    const out = await fn()
    runs.push(performance.now() - started)
    size = JSON.stringify(out)?.length ?? 0
  }
  runs.sort((a, b) => a - b)
  const median = runs[Math.floor(runs.length / 2)]!
  const kb = size / 1024
  console.log(`  ${label.padEnd(22)} ${`${Math.round(median)}ms`.padStart(8)}  ${(kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${Math.round(kb)} KB`).padStart(9)}`)
}

async function main(): Promise<void> {
  if (env.NODE_ENV === 'production') {
    logger.error('Refusing to benchmark against production.')
    process.exit(1)
  }
  const { values } = parseArgs({ options: { only: { type: 'string' }, repeat: { type: 'string', default: '3' } } })
  const repeat = Math.max(1, Number(values.repeat) || 3)

  const demo = await db.query.user.findFirst({ where: eq(userTable.email, EMAIL), columns: { id: true } })
  if (!demo) {
    logger.error(`No ${EMAIL} account: run \`pnpm db:seed\` first.`)
    process.exit(1)
  }
  const owned = await db.query.member.findFirst({ where: and(eq(member.userId, demo.id), eq(member.role, 'owner')), columns: { organizationId: true } })
  const orgId = owned!.organizationId
  const only = values.only?.split(',').map(s => s.trim())
  const projects = await db.query.project.findMany({
    where: and(eq(project.organizationId, orgId), only ? inArray(project.slug, only) : like(project.slug, 'perf-%')),
    orderBy: project.slug,
  })
  if (!projects.length) {
    logger.error(only ? `No project ${values.only} in the demo workspace.` : 'No perf-* project: run `pnpm db:seed:perf` first.')
    process.exit(1)
  }

  console.log(`workspace (${repeat} calls per read, median)`)
  await time('overview', repeat, () => loadOverview(orgId))
  for (const p of projects) {
    const rows = await db.$count(test, eq(test.projectId, p.id))
    console.log(`\n${p.slug} (${rows.toLocaleString('en-US')} test rows)`)
    const latest = await loadLatestRun(p.id)
    const anyTest = await db.query.test.findFirst({ where: eq(test.projectId, p.id), columns: { testKey: true } })
    await time('projectHistory', repeat, () => loadProjectHistory(p))
    await time('componentHistory', repeat, () => loadProjectHistory(p, { componentsOnly: true }))
    await time('clusters', repeat, () => loadProjectClusters(p))
    await time('analytics 30d', repeat, () => loadProjectAnalytics(p.id, 30))
    await time('analytics 90d', repeat, () => loadProjectAnalytics(p.id, 90))
    await time('runs page', repeat, () => loadRunPage(p))
    if (latest) {
      await time('run report', repeat, () => loadRunReport(p, latest))
      const head = await testsOfRun(latest.id)
      // The PR comment's regression, as if the latest run were a pull request on its own branch.
      await time('regression', repeat, () => computeRegression(p.id, head, { branch: latest.git?.branch, startedAt: latest.startedAt }))
    }
    if (anyTest)
      await time('testHistoryPage', repeat, () => loadTestHistoryPage(p, anyTest.testKey))
  }
  process.exit(0)
}

main().catch((err) => {
  logger.error(err)
  process.exit(1)
})
