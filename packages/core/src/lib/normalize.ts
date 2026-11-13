import type { Counts, NormTest, RunReport, RunSummary } from '../contracts/kinora'
import type { PlaywrightReport, PwSpec } from '../contracts/playwright'
import { SCHEMA_VERSION } from '../contracts/kinora'
import { playwrightReportSchema } from '../contracts/playwright'
import { a11yFromScans, parseAxeScan } from './a11y'
import { effectiveAttachments } from './attachments'
import { makeTestKey } from './test-key'

// Provided by the CLI (which has fs access): copies a Playwright attachment
// (from disk path or inline base64 body) somewhere hostable and returns a
// relative URL. Core stays fs-free; the side effect is injected.
export type CopyArtifact = (
  attachment: { name: string, contentType: string, path?: string, body?: string },
  ctx: { projectId: string, runId: string, testKey: string, status: NormTest['status'] },
) => string | undefined

export interface IngestMeta {
  projectId: string
  runId: string
  git?: RunSummary['git']
  ci?: RunSummary['ci']
  copyArtifact?: CopyArtifact
}

interface WalkCtx {
  titlePath: string[]
  file: string
}

function flattenSpecs(
  suites: PlaywrightReport['suites'],
  parent: WalkCtx,
  out: NormTest[],
  meta: IngestMeta,
): void {
  for (const suite of suites) {
    const ctx: WalkCtx = {
      file: suite.file || parent.file,
      titlePath: suite.title ? [...parent.titlePath, suite.title] : parent.titlePath,
    }
    for (const spec of suite.specs) normalizeSpec(spec, ctx, out, meta)
    if (suite.suites)
      flattenSpecs(suite.suites, ctx, out, meta)
  }
}

// Past this size (in base64) a JSON attachment is not an axe scan worth decoding.
const MAX_SCAN_BASE64 = 28 * 1024 * 1024

// The axe scans a test attached as JSON with an inline body, which the JSON report carries in
// base64. A scan attached as a file is only read by the reporter: core has no file access.
function axeScans(attachments: { contentType: string, body?: string }[]): { violations: unknown[] }[] {
  return attachments.flatMap((a) => {
    if (!a.body || a.body.length > MAX_SCAN_BASE64 || !a.contentType.includes('json'))
      return []
    try {
      const scan = parseAxeScan(new TextDecoder().decode(Uint8Array.from(atob(a.body), c => c.charCodeAt(0))))
      return scan ? [scan] : []
    }
    catch {
      return [] // not base64
    }
  })
}

function normalizeSpec(spec: PwSpec, ctx: WalkCtx, out: NormTest[], meta: IngestMeta): void {
  const file = spec.file || ctx.file
  const titlePath = [...ctx.titlePath, spec.title]
  for (const test of spec.tests) {
    const last = test.results.at(-1)
    const testKey = makeTestKey(file, titlePath, test.projectName)
    const attachments = effectiveAttachments(test.results)
    const a11y = a11yFromScans(axeScans(attachments), spec.ok)
    out.push({
      testKey,
      title: spec.title,
      titlePath,
      file,
      line: spec.line,
      column: spec.column,
      projectName: test.projectName,
      status: test.status,
      ok: spec.ok,
      duration: test.results.reduce((s, r) => s + r.duration, 0),
      retries: Math.max(0, test.results.length - 1),
      tags: spec.tags,
      annotations: test.annotations.map(a => ({ type: a.type, description: a.description })),
      errors: (last?.errors ?? []).flatMap(e =>
        e.message ? [{ message: e.message, stack: e.stack, location: e.location }] : [],
      ),
      attachments: attachments.map(a => ({
        name: a.name,
        contentType: a.contentType,
        path: a.path,
        hasBody: a.body != null,
        url: meta.copyArtifact?.(
          { name: a.name, contentType: a.contentType, path: a.path, body: a.body },
          { projectId: meta.projectId, runId: meta.runId, testKey, status: test.status },
        ),
      })),
      ...a11y && { a11y },
    })
  }
}

function countsFrom(report: PlaywrightReport, tests: NormTest[]): Counts {
  const s = report.stats
  return {
    total: tests.length,
    expected: s.expected,
    unexpected: s.unexpected,
    flaky: s.flaky,
    skipped: s.skipped,
  }
}

function emptyCounts(): Counts {
  return { total: 0, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
}

export function countsFromTests(tests: Pick<NormTest, 'status'>[]): Counts {
  const c = emptyCounts()
  for (const t of tests) {
    c.total++
    c[t.status]++
  }
  return c
}

export function countsByTagFrom(tests: Pick<NormTest, 'tags' | 'status'>[]): Record<string, Counts> {
  const out: Record<string, Counts> = {}
  for (const t of tests) {
    for (const tag of t.tags) {
      const c = (out[tag] ??= emptyCounts())
      c.total++
      c[t.status]++
    }
  }
  return out
}

function flattenReport(report: PlaywrightReport, meta: IngestMeta): NormTest[] {
  const tests: NormTest[] = []
  flattenSpecs(report.suites, { titlePath: [], file: '' }, tests, meta)
  return tests
}

// The tests of a Playwright JSON report, including a `--list` one, with the same identity as ingest.
export function playwrightReportTests(raw: unknown): NormTest[] {
  return flattenReport(playwrightReportSchema.parse(raw), { projectId: '', runId: '' })
}

// Parse + normalize a raw Playwright JSON report into the kinora contract.
// Attachment bodies are dropped (only metadata kept) to keep payloads small.
export function ingestPlaywrightReport(
  raw: unknown,
  meta: IngestMeta,
): { summary: RunSummary, report: RunReport } {
  const parsed: PlaywrightReport = playwrightReportSchema.parse(raw)
  const tests = flattenReport(parsed, meta)

  const counts = countsFrom(parsed, tests)
  const startedAt = parsed.stats.startTime
  const duration = parsed.stats.duration
  const playwrightVersion = parsed.config?.version

  const reportPath = `reports/${meta.projectId}/${meta.runId}.json`
  const summary: RunSummary = {
    runId: meta.runId,
    projectId: meta.projectId,
    startedAt,
    duration,
    counts,
    playwrightVersion,
    git: meta.git,
    ci: meta.ci,
    reportPath,
    countsByTag: countsByTagFrom(tests),
  }
  const report: RunReport = {
    schemaVersion: SCHEMA_VERSION,
    runId: meta.runId,
    projectId: meta.projectId,
    startedAt,
    duration,
    counts,
    meta: { playwrightVersion, git: meta.git, ci: meta.ci },
    tests,
  }
  return { summary, report }
}
