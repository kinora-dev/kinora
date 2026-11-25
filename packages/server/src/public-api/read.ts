import type { FailureCause, FailureCluster } from '@kinora/core'
import type { Hono } from 'hono'
import type { project } from '../db/schemas/index'
import { byInboxPriority, clusterState, fingerprintError, isOpenCluster, isSnoozed } from '@kinora/core'
import { env } from '../lib/env'
import { loadQuarantinedTests } from '../reports/quarantine'
import { findProject, listProjects, loadLatestRun, loadProjectClusters, loadProjectHistory, loadRun, loadRunReport, loadRunSummaries, loadTestDurations, loadTestHistory } from '../reports/queries'

type ReadApi = Hono<{ Variables: { orgId: string } }>

const DEFAULT_RUNS_LIMIT = 50
const MAX_RUNS_LIMIT = 200
const DEFAULT_DURATION_RUNS = 30

function limitParam(raw: string | undefined, fallback: number): number {
  const n = Number(raw)
  return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), MAX_RUNS_LIMIT) : fallback
}

function toCause(p: typeof project.$inferSelect, c: FailureCluster): FailureCause {
  return {
    ...c,
    project: { id: p.slug, name: p.name },
    state: clusterState(c),
    snoozed: isSnoozed(c),
    url: `${env.WEB_ORIGIN}/projects/${encodeURIComponent(p.slug)}/tests?cluster=${c.fingerprint}`,
  }
}

// Registered on publicApi so these inherit its Bearer auth, org scope, and rate limit.
export function registerReadRoutes(api: ReadApi): void {
  api.get('/projects', async (c) => {
    const projects = await listProjects(c.get('orgId'))
    const out = await Promise.all(projects.map(async (p) => {
      const [latest] = await loadRunSummaries(p, 1)
      return {
        id: p.slug,
        name: p.name,
        description: p.description ?? undefined,
        latestRun: latest ?? null,
      }
    }))
    return c.json({ projects: out })
  })

  api.get('/projects/:slug/runs', async (c) => {
    const p = await findProject(c.get('orgId'), c.req.param('slug'))
    if (!p)
      return c.json({ error: 'Project not found' }, 404)
    return c.json({ runs: await loadRunSummaries(p, limitParam(c.req.query('limit'), DEFAULT_RUNS_LIMIT)) })
  })

  api.get('/projects/:slug/runs/:runId', async (c) => {
    const p = await findProject(c.get('orgId'), c.req.param('slug'))
    if (!p)
      return c.json({ error: 'Project not found' }, 404)
    const runId = c.req.param('runId')
    const r = runId === 'latest' ? await loadLatestRun(p.id) : await loadRun(p.id, runId)
    if (!r)
      return c.json({ error: 'Run not found' }, 404)
    return c.json(await loadRunReport(p, r))
  })

  api.get('/projects/:slug/failures', async (c) => {
    const p = await findProject(c.get('orgId'), c.req.param('slug'))
    if (!p)
      return c.json({ error: 'Project not found' }, 404)
    const runId = c.req.query('runId')
    const r = !runId || runId === 'latest' ? await loadLatestRun(p.id) : await loadRun(p.id, runId)
    if (!r)
      return c.json({ error: 'Run not found' }, 404)
    const [report, clusters] = await Promise.all([loadRunReport(p, r), loadProjectClusters(p)])
    const failures = report.tests.filter(t => t.status === 'unexpected' || t.status === 'flaky')
    // Matched by fingerprint: an older run or an incident gets the causes its errors still have in the window.
    const fingerprints = new Set(failures.flatMap(t => t.errors[0] ? [fingerprintError(t.errors[0]).fingerprint] : []))
    return c.json({
      runId: report.runId,
      startedAt: report.startedAt,
      counts: report.counts,
      ...(report.meta.incident && { incident: report.meta.incident }),
      failures,
      causes: clusters.filter(cl => fingerprints.has(cl.fingerprint)).map(cl => toCause(p, cl)),
    })
  })

  // The open failure causes of every project, or of `?project=`, as the dashboard's failure inbox.
  api.get('/causes', async (c) => {
    const slug = c.req.query('project')
    const projects = slug ? [await findProject(c.get('orgId'), slug)] : await listProjects(c.get('orgId'))
    if (projects.some(p => !p))
      return c.json({ error: 'Project not found' }, 404)
    const causes = await Promise.all(projects.map(async p => (await loadProjectClusters(p!)).filter(isOpenCluster).map(cl => toCause(p!, cl))))
    return c.json({ causes: causes.flat().sort(byInboxPriority) })
  })

  api.get('/projects/:slug/history', async (c) => {
    const p = await findProject(c.get('orgId'), c.req.param('slug'))
    if (!p)
      return c.json({ error: 'Project not found' }, 404)
    const testKey = c.req.query('testKey')
    if (testKey) {
      const history = await loadTestHistory(p, testKey)
      return c.json({ histories: history ? [history] : [] })
    }
    const { histories } = await loadProjectHistory(p)
    return c.json({ histories })
  })

  api.get('/projects/:slug/test-durations', async (c) => {
    const p = await findProject(c.get('orgId'), c.req.param('slug'))
    if (!p)
      return c.json({ error: 'Project not found' }, 404)
    return c.json(await loadTestDurations(p, limitParam(c.req.query('runs'), DEFAULT_DURATION_RUNS)))
  })

  api.get('/projects/:slug/quarantines', async (c) => {
    const p = await findProject(c.get('orgId'), c.req.param('slug'))
    if (!p)
      return c.json({ error: 'Project not found' }, 404)
    return c.json({ quarantines: await loadQuarantinedTests(p) })
  })
}
