import type { createReadClient } from '@kinora/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildComponents, byInstability, IngestError, isUnstable, windowStats } from '@kinora/core'
import { z } from 'zod'
import { formatComponent, formatFailure, formatHistory, traceUrlOf } from './format'

type ReadClient = ReturnType<typeof createReadClient>

const MAX_HISTORY_RESULTS = 25
const MAX_COMPONENTS = 50
const MAX_RUN_TESTS = 1000
// Each formatted failure carries up to ~8KB of error + stack; cap so a broken run can't flood the agent's context.
const MAX_FAILURES = 50

function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true }
}

// Surface the server's JSON error message (e.g. "Project not found") instead of a raw stack.
async function guard<T>(fn: () => Promise<T>, wrap: (v: T) => ReturnType<typeof ok>) {
  try {
    return wrap(await fn())
  }
  catch (err) {
    if (err instanceof IngestError)
      return fail(`kinora: ${err.message}`)
    return fail(`kinora: ${err instanceof Error ? err.message : String(err)}`)
  }
}

export function registerTools(server: McpServer, client: ReadClient): void {
  server.registerTool('list_projects', {
    title: 'List kinora projects',
    description: 'List every project on the kinora server with its latest run summary (pass/fail counts, git branch, started time).',
    inputSchema: z.object({}),
  }, () => guard(() => client.listProjects(), ps => ok({ projects: ps })))

  server.registerTool('list_failures', {
    title: 'List failing tests of a run',
    description: 'Failing and flaky tests of a run (defaults to the latest run): error message, file:line, and a trace.zip URL to open in the Playwright viewer. Start here to debug the last CI failures.',
    inputSchema: z.object({
      project: z.string().describe('Project slug (from list_projects).'),
      runId: z.string().optional().describe('Run id; omit for the latest run.'),
    }),
  }, ({ project, runId }) => guard(
    () => client.getFailures(project, runId),
    r => ok({
      runId: r.runId,
      startedAt: r.startedAt,
      counts: r.counts,
      failures: r.failures.slice(0, MAX_FAILURES).map(formatFailure),
      ...(r.failures.length > MAX_FAILURES && { truncated: `showing ${MAX_FAILURES} of ${r.failures.length} failures` }),
    }),
  ))

  server.registerTool('get_run', {
    title: 'Get a run report',
    description: 'Full report for one run (defaults to latest): counts, git/CI metadata, every test status, and formatted failures with errors + trace URLs.',
    inputSchema: z.object({
      project: z.string().describe('Project slug.'),
      runId: z.string().optional().describe('Run id; omit for the latest run.'),
    }),
  }, ({ project, runId }) => guard(
    () => client.getRun(project, runId),
    (r) => {
      const failures = r.tests.filter(t => t.status === 'unexpected' || t.status === 'flaky')
      return ok({
        runId: r.runId,
        startedAt: r.startedAt,
        duration: r.duration,
        counts: r.counts,
        meta: r.meta,
        failures: failures.slice(0, MAX_FAILURES).map(formatFailure),
        tests: r.tests.slice(0, MAX_RUN_TESTS).map(t => ({ testKey: t.testKey, title: t.title, status: t.status, location: `${t.file}:${t.line}` })),
        ...((failures.length > MAX_FAILURES || r.tests.length > MAX_RUN_TESTS) && {
          truncated: `showing ${Math.min(failures.length, MAX_FAILURES)}/${failures.length} failures, ${Math.min(r.tests.length, MAX_RUN_TESTS)}/${r.tests.length} tests`,
        }),
      })
    },
  ))

  server.registerTool('test_history', {
    title: 'Per-test history',
    description: 'History of a test across recent runs to tell a fresh regression from a chronic/flaky test: pass/fail/flaky rates, recent-window rates, newlyBroken/newlyFlaky flags, and recent per-run points. Pass testKey for one test, query to search by title, or neither to get the most unstable tests.',
    inputSchema: z.object({
      project: z.string().describe('Project slug.'),
      testKey: z.string().optional().describe('Exact test key (from list_failures) for a single test.'),
      query: z.string().optional().describe('Case-insensitive substring match on the test title.'),
    }),
  }, ({ project, testKey, query }) => guard(
    () => client.getHistory(project, testKey),
    (histories) => {
      let out = histories
      if (!testKey && query) {
        const q = query.toLowerCase()
        out = histories.filter(h => h.title.toLowerCase().includes(q))
      }
      else if (!testKey) {
        out = histories.filter(isUnstable).sort(byInstability)
      }
      return ok({ histories: out.slice(0, MAX_HISTORY_RESULTS).map(formatHistory) })
    },
  ))

  server.registerTool('component_health', {
    title: 'Component and story health',
    description: 'Health of the UI components a project tests with Playwright component tests (stories recorded by @kinora/reporter/ct), grouped by component: per story, its latest status, whether it failed or flaked in the last 20 runs, fail/flaky rates, and the tests that mount it. Filter by component name or story id, or ask for unstable stories only. Empty when the project records no stories.',
    inputSchema: z.object({
      project: z.string().describe('Project slug.'),
      component: z.string().optional().describe('Case-insensitive substring of a component name, path or story id, e.g. "Button".'),
      unstableOnly: z.boolean().optional().describe('Only stories that failed or flaked in the last 20 runs.'),
    }),
  }, ({ project, component, unstableOnly }) => guard(
    () => client.getHistory(project),
    (histories) => {
      const q = component?.toLowerCase()
      const components = buildComponents(histories)
        .map(c => ({
          component: c,
          stories: c.stories.filter(s =>
            (!unstableOnly || windowStats(s.points).unstable)
            && (!q || c.path.toLowerCase().includes(q) || s.id.toLowerCase().includes(q))),
        }))
        .filter(c => c.stories.length)
      return ok({
        components: components.slice(0, MAX_COMPONENTS).map(c => formatComponent(c.component, c.stories)),
        ...(components.length > MAX_COMPONENTS && { truncated: `showing ${MAX_COMPONENTS} of ${components.length} components` }),
        ...(!histories.some(h => h.stories?.length) && { note: 'No component stories recorded for this project. Component tests must import test from @kinora/reporter/ct.' }),
      })
    },
  ))

  server.registerTool('get_trace', {
    title: 'Get a test trace URL',
    description: 'Resolve the Playwright trace.zip URL for one test in a run (defaults to latest), to open in the trace viewer or download for inspection.',
    inputSchema: z.object({
      project: z.string().describe('Project slug.'),
      testKey: z.string().describe('Test key (from list_failures).'),
      runId: z.string().optional().describe('Run id; omit for the latest run.'),
    }),
  }, ({ project, testKey, runId }) => guard(
    () => client.getRun(project, runId),
    (report) => {
      const t = report.tests.find(t => t.testKey === testKey)
      if (!t)
        return fail(`kinora: test not found in run ${report.runId}: ${testKey}`)
      const url = traceUrlOf(t)
      if (!url)
        return fail(`kinora: no trace attached for ${testKey} in run ${report.runId}`)
      return ok({ runId: report.runId, testKey, traceUrl: url })
    },
  ))
}
