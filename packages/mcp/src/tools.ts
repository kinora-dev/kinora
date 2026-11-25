import type { createReadClient, FailureCause, NormTest, QuarantinedTest } from '@kinora/core'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { buildComponents, byInstability, diagnose, fingerprintError, IngestError } from '@kinora/core'
import { z } from 'zod'
import { formatCause, formatCauseRef, formatComponent, formatFailure, formatHistory, formatHistoryInList, formatProject, traceUrlOf } from './format'

type ReadClient = ReturnType<typeof createReadClient>

const MAX_HISTORY_RESULTS = 25
const MAX_COMPONENTS = 50
const MAX_RUN_TESTS = 1000
// Each formatted failure carries up to ~8KB of error + stack; cap so a broken run can't flood the agent's context.
const MAX_FAILURES = 50
const MAX_CAUSES = 25

// Compact: indentation alone made a third of a workspace's project list.
function ok(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] }
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

interface FailureContext {
  causes?: FailureCause[]
  quarantines?: QuarantinedTest[]
}

// What the server knows around a run's failures. It only enriches them, so failing to read it
// (an older server, a hiccup) never fails the tool.
async function failureContext(client: ReadClient, project: string, runId: string, causes?: FailureCause[]): Promise<FailureContext> {
  const optional = <T>(read: () => Promise<T>) => Promise.resolve().then(read).catch(() => undefined)
  const [fetched, quarantines] = await Promise.all([
    causes ?? optional(async () => (await client.getFailures(project, runId)).causes),
    optional(() => client.getQuarantines(project)),
  ])
  return { causes: fetched, quarantines }
}

// A failure with the cause it shares with other tests and its quarantine, when the server knows them.
function withContext(t: NormTest, ctx: FailureContext) {
  const fingerprint = t.errors[0] && fingerprintError(t.errors[0]).fingerprint
  const cause = ctx.causes?.find(c => c.fingerprint === fingerprint)
  const q = ctx.quarantines?.find(q => q.testKey === t.testKey)
  return {
    ...formatFailure(t),
    ...(cause && { cause: formatCauseRef(cause) }),
    ...(q && { quarantined: { ...(q.reason && { reason: q.reason }), ...(q.expiresAt && { expiresAt: q.expiresAt }) } }),
  }
}

// `health` picks flaky or broken stories; the older `unstableOnly` means either of them.
function matchesHealth(kind: 'stable' | 'flaky' | 'broken', health?: 'flaky' | 'broken', unstableOnly?: boolean): boolean {
  if (health)
    return kind === health
  return !unstableOnly || kind !== 'stable'
}

export function registerTools(server: McpServer, client: ReadClient): void {
  server.registerTool('list_projects', {
    title: 'List kinora projects',
    description: 'List every project on the kinora server with its latest run summary (pass/fail counts, git branch and commit, started time, and whether it was an environment incident).',
    inputSchema: z.object({}),
  }, () => guard(() => client.listProjects(), ps => ok({ projects: ps.map(formatProject) })))

  server.registerTool('list_failures', {
    title: 'List failing tests of a run',
    description: 'Failing and flaky tests of a run (defaults to the latest run): error message, file:line, and a trace.zip URL to open in the Playwright viewer. Start here to debug the last CI failures. When the result has an `incident`, the run is an environment incident: its failures come from the app under test or the browser being down, not from the code, so re-run rather than fix the tests. A failure\'s `cause` is the error it shares with other tests, and what the team decided about it: read its `assignee`, `issueUrl` and `note` before digging, someone may already be on it. `state` is failing, regressed (marked resolved, failing again: the fix didn\'t hold), stopped (its tests pass again), resolved or ignored. A `quarantined` failure is a known flaky test the team set aside, with their reason. A failed screenshot assertion lists its `screenshots`: the expected, actual and diff image URLs.',
    inputSchema: z.object({
      project: z.string().describe('Project slug (from list_projects).'),
      runId: z.string().optional().describe('Run id; omit for the latest run.'),
    }),
  }, ({ project, runId }) => guard(
    async () => {
      const r = await client.getFailures(project, runId)
      return { ...r, ctx: await failureContext(client, project, r.runId, r.causes ?? []) }
    },
    r => ok({
      runId: r.runId,
      startedAt: r.startedAt,
      counts: r.counts,
      ...(r.incident && { incident: r.incident }),
      failures: r.failures.slice(0, MAX_FAILURES).map(t => withContext(t, r.ctx)),
      ...(r.failures.length > MAX_FAILURES && { truncated: `showing ${MAX_FAILURES} of ${r.failures.length} failures` }),
    }),
  ))

  server.registerTool('list_open_failures', {
    title: 'List open failure causes',
    description: 'Open failure causes across projects (or one project), as the dashboard\'s failure inbox: failing tests grouped by error, each with its state, affected tests, error, and what the team decided (assignee, known issue URL, note, snooze). `state` is failing, regressed (marked resolved, failing again: the fix didn\'t hold) or stopped (its tests pass again, likely fixed but not marked resolved). Regressions come first, then the latest failures. Use it to see what is broken and already tracked before investigating; list_failures on its lastRunId gives every failing test of the cause, test_history the history of one.',
    inputSchema: z.object({
      project: z.string().optional().describe('Project slug; omit for every project.'),
      state: z.enum(['failing', 'regressed', 'stopped']).optional().describe('Only causes in this state.'),
      includeSnoozed: z.boolean().optional().describe('Include causes someone snoozed (left out by default, as in the inbox).'),
    }),
  }, ({ project, state, includeSnoozed }) => guard(
    () => client.getOpenCauses(project),
    (causes) => {
      const out = causes.filter(c => (!state || c.state === state) && (includeSnoozed || !c.snoozed))
      return ok({
        causes: out.slice(0, MAX_CAUSES).map(formatCause),
        ...(out.length > MAX_CAUSES && { truncated: `showing ${MAX_CAUSES} of ${out.length} causes; pass project or state to narrow` }),
      })
    },
  ))

  server.registerTool('get_run', {
    title: 'Get a run report',
    description: 'Full report for one run (defaults to latest): counts, git/CI metadata, every test status, and formatted failures with errors, trace URLs, screenshot images, their `cause` and quarantine (see list_failures).',
    inputSchema: z.object({
      project: z.string().describe('Project slug.'),
      runId: z.string().optional().describe('Run id; omit for the latest run.'),
    }),
  }, ({ project, runId }) => guard(
    async () => {
      const report = await client.getRun(project, runId)
      // By the resolved id: a run landing in between would make a second `latest` another run.
      return { ...report, ctx: await failureContext(client, project, report.runId) }
    },
    (r) => {
      const failures = r.tests.filter(t => t.status === 'unexpected' || t.status === 'flaky')
      return ok({
        runId: r.runId,
        startedAt: r.startedAt,
        duration: r.duration,
        counts: r.counts,
        meta: r.meta,
        failures: failures.slice(0, MAX_FAILURES).map(t => withContext(t, r.ctx)),
        tests: r.tests.slice(0, MAX_RUN_TESTS).map(t => ({ testKey: t.testKey, title: t.title, status: t.status, location: `${t.file}:${t.line}` })),
        ...((failures.length > MAX_FAILURES || r.tests.length > MAX_RUN_TESTS) && {
          truncated: `showing ${Math.min(failures.length, MAX_FAILURES)}/${failures.length} failures, ${Math.min(r.tests.length, MAX_RUN_TESTS)}/${r.tests.length} tests`,
        }),
      })
    },
  ))

  server.registerTool('test_history', {
    title: 'Per-test history',
    description: 'History of a test across recent runs to tell a fresh regression from a chronic/flaky test: health over the last 20 runs (flaky: passed and failed on the same commit, needed a retry, or keeps flipping between pass and fail; broken: fails and keeps failing) with its reason, pass/fail/flaky rates, recent-window rates, newlyBroken/newlyFlaky flags, and recent per-run points with their commit (the last 20 for one test, the last 5 when listing several). Pass testKey for one test, query to search by title, or neither to get the flaky and broken tests.',
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
        out = histories.filter(h => diagnose(h.points).kind !== 'stable').sort(byInstability)
      }
      if (testKey && !out.length)
        return ok({ histories: [], note: `No test with key ${testKey} in the project's recent runs. Test keys come from list_failures or get_run; query searches by title.` })
      return ok({ histories: out.slice(0, MAX_HISTORY_RESULTS).map(testKey ? h => formatHistory(h) : formatHistoryInList) })
    },
  ))

  server.registerTool('component_health', {
    title: 'Component and story health',
    description: 'Health of the UI components a project tests, from Playwright component tests (stories recorded by @kinora/reporter/ct) or Storybook stories run by Vitest (@kinora/vitest-reporter), grouped by component: per story, its latest status, its health over the last 20 runs (flaky or broken, with the reason), its accessibility violations when the Storybook a11y addon checks it (rule, impact, failing elements, docs link), fail/flaky rates, and the tests that mount it. Filter by component name or story id, or by health. Empty when the project records no stories.',
    inputSchema: z.object({
      project: z.string().describe('Project slug.'),
      component: z.string().optional().describe('Case-insensitive substring of a component name, path or story id, e.g. "Button".'),
      health: z.enum(['flaky', 'broken']).optional().describe('Only flaky or only broken stories.'),
      unstableOnly: z.boolean().optional().describe('Only flaky or broken stories.'),
    }),
  }, ({ project, component, health, unstableOnly }) => guard(
    () => client.getHistory(project),
    (histories) => {
      const q = component?.toLowerCase()
      const components = buildComponents(histories)
        .map(c => ({
          component: c,
          stories: c.stories.filter(s =>
            matchesHealth(diagnose(s.points).kind, health, unstableOnly)
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
