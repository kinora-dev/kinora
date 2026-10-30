import type { Hono } from 'hono'
import { findProject, listProjects, loadLatestRun, loadProjectHistory, loadRun, loadRunReport, loadRunSummaries, loadTestHistory } from '../reports/queries'

type ReadApi = Hono<{ Variables: { orgId: string } }>

const DEFAULT_RUNS_LIMIT = 50
const MAX_RUNS_LIMIT = 200

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
    const raw = Number(c.req.query('limit'))
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(raw, MAX_RUNS_LIMIT) : DEFAULT_RUNS_LIMIT
    return c.json({ runs: await loadRunSummaries(p, limit) })
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
    const report = await loadRunReport(p, r)
    return c.json({
      runId: report.runId,
      startedAt: report.startedAt,
      counts: report.counts,
      ...(report.meta.incident && { incident: report.meta.incident }),
      failures: report.tests.filter(t => t.status === 'unexpected' || t.status === 'flaky'),
    })
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
}
