import type { ComponentHealth, NormTest, StoryHealth, TestHistory, TestPoint } from '@kinora/core'
import { windowStats } from '@kinora/core'

const MAX_ERROR_CHARS = 4000
const MAX_HISTORY_POINTS = 20

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

function point(p: TestPoint) {
  return { runId: p.runId, startedAt: p.startedAt, status: p.status, errorMessage: p.errorMessage }
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
    ...(h.stories?.length && { stories: h.stories }),
    recentPoints: h.points.slice(-MAX_HISTORY_POINTS).map(point),
  }
}

// Same window and "unstable" rule as the dashboard's Components page.
export function formatStory(s: StoryHealth) {
  const recent = windowStats(s.points)
  return {
    id: s.id,
    name: s.name,
    lastStatus: s.lastStatus,
    unstable: recent.unstable,
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
