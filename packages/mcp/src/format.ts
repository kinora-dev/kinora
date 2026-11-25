import type { A11yReport, ComponentHealth, FailureCause, NormTest, StoryHealth, TestHistory, TestPoint } from '@kinora/core'
import { byImpact, describeHealth, diagnose, windowStats } from '@kinora/core'

const MAX_ERROR_CHARS = 4000
const MAX_HISTORY_POINTS = 20
const MAX_CAUSE_TESTS = 20

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}\n… (truncated)` : s
}

// Read-side attachments carry a resolved url but no local path, so match on name/contentType
// (not isTraceAttachment, which keys off the reporter's local path).
export function traceUrlOf(t: NormTest): string | null {
  const trace = t.attachments.find(a => a.url && (a.name === 'trace' || a.contentType === 'application/zip' || a.url.endsWith('.zip')))
  return trace?.url ?? null
}

export function formatFailure(t: NormTest) {
  const err = t.errors[0]
  return {
    testKey: t.testKey,
    title: t.title,
    titlePath: t.titlePath,
    location: `${t.file}:${t.line}:${t.column}`,
    projectName: t.projectName,
    status: t.status,
    retries: t.retries,
    error: err
      ? { message: truncate(err.message, MAX_ERROR_CHARS), location: err.location, stack: err.stack ? truncate(err.stack, MAX_ERROR_CHARS) : undefined }
      : null,
    traceUrl: traceUrlOf(t),
  }
}

// What the team decided about a cause, without the parts of its error or tests a failure already shows.
export function formatCauseRef(c: FailureCause) {
  const t = c.triage
  return {
    fingerprint: c.fingerprint,
    state: c.state,
    ...(c.snoozed && { snoozed: true }),
    tests: c.tests,
    ...(t?.assignee && { assignee: t.assignee.name }),
    ...(t?.issueUrl && { issueUrl: t.issueUrl }),
    ...(t?.note && { note: t.note }),
    ...(t?.resolvedAt && { resolvedAt: t.resolvedAt, ...(t.resolvedBy && { resolvedBy: t.resolvedBy }) }),
    url: c.url,
  }
}

export function formatCause(c: FailureCause) {
  return {
    project: c.project.id,
    title: c.title,
    ...formatCauseRef(c),
    occurrences: c.count,
    firstSeen: c.firstSeen,
    lastSeen: c.lastSeen,
    lastRunId: c.lastRunId,
    ...(c.quietRuns && { quietRuns: c.quietRuns }),
    ...(c.codeOwners?.length && { codeOwners: c.codeOwners }),
    error: truncate(c.sample, MAX_ERROR_CHARS),
    testKeys: c.testKeys.slice(0, MAX_CAUSE_TESTS),
    ...(c.testKeys.length > MAX_CAUSE_TESTS && { testKeysTruncated: `showing ${MAX_CAUSE_TESTS} of ${c.testKeys.length}` }),
  }
}

function point(p: TestPoint) {
  return { runId: p.runId, startedAt: p.startedAt, status: p.status, ...(p.sha && { sha: p.sha }), errorMessage: p.errorMessage }
}

// Accessibility check (Storybook's a11y addon), most severe violation first. An agent fixing it
// needs the rule, the elements and the docs.
function a11y(report: A11yReport | undefined) {
  if (!report)
    return {}
  return { a11y: { ...report, violations: [...report.violations].sort(byImpact) } }
}

// Flaky or broken over the last 20 runs, as the dashboard shows it, with the reason in a sentence.
function health(points: TestPoint[]) {
  const h = diagnose(points)
  return { health: h.kind, ...(h.kind !== 'stable' && { healthReason: describeHealth(h) }) }
}

export function formatHistory(h: TestHistory) {
  return {
    testKey: h.testKey,
    title: h.title,
    file: h.file,
    projectName: h.projectName,
    lastStatus: h.lastStatus,
    runs: h.runs,
    passRate: h.passRate,
    failRate: h.failRate,
    flakyRate: h.flakyRate,
    recentFailRate: h.recentFailRate,
    recentFlakyRate: h.recentFlakyRate,
    newlyBroken: h.newlyBroken,
    newlyFlaky: h.newlyFlaky,
    ...health(h.points),
    ...a11y(h.a11y),
    ...(h.stories?.length && { stories: h.stories }),
    recentPoints: h.points.slice(-MAX_HISTORY_POINTS).map(point),
  }
}

// Same window and flaky / broken rules as the dashboard's Components page. `unstable` (failed or
// flaked at least once) predates `health` and stays for existing clients.
export function formatStory(s: StoryHealth) {
  const recent = windowStats(s.points)
  return {
    id: s.id,
    name: s.name,
    lastStatus: s.lastStatus,
    unstable: recent.unstable,
    ...health(s.points),
    ...a11y(s.a11y),
    failRate: recent.failRate,
    flakyRate: recent.flakyRate,
    recentStatuses: s.points.slice(-MAX_HISTORY_POINTS).map(p => p.status),
    tests: s.tests.map(t => ({ testKey: t.testKey, title: t.title, file: t.file, lastStatus: t.lastStatus })),
  }
}

export function formatComponent(c: ComponentHealth, stories: StoryHealth[] = c.stories) {
  return {
    name: c.name || '(no component)',
    path: c.path,
    lastStatus: c.lastStatus,
    stories: stories.map(formatStory),
  }
}
