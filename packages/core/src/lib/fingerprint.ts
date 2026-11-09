import type { FailureCluster, NormError, RunReport } from '../contracts/kinora'
import { stripAnsi } from './ansi'

// Collapse a raw error message to a signature: strip only the parts that vary run-to-run
// (paths, line:col, timeouts, ids) so the same root cause hashes the same. Bare numbers are
// kept on purpose - stripping them would merge distinct assertions (toBe(500) vs toBe(404)).
export function normalizeErrorMessage(raw: string): string {
  return stripAnsi(raw)
    .replace(/\r\n/g, '\n')
    .slice(0, 4000)
    .replace(/^\s*at\s.*$/gm, '') // stack frames
    .replace(/https?:\/\/\S+/gi, '<url>')
    .replace(/[a-z]:\\[\w\\.-]+|(?:\/[\w.-]+)+\.[a-z]{1,5}/gi, '<path>')
    .replace(/\b[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}\b/gi, '<uuid>')
    .replace(/0x[0-9a-f]+/gi, '<hex>')
    .replace(/:\d+:\d+/g, '') // line:col
    .replace(/\b\d+(?:\.\d+)?\s?(?:ms|s)\b/gi, '<dur>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

// FNV-1a, 32-bit, base36. Pure + browser-safe (no node crypto), stable across runs.
function hash(s: string): string {
  let h = 0x811C9DC5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

export interface ErrorFingerprint {
  fingerprint: string
  title: string // first line, plus the locator of a Playwright assertion, human-readable
  sample: string // full stripped message
}

export function fingerprintError(err: Pick<NormError, 'message' | 'stack'>): ErrorFingerprint {
  const source = err.message || err.stack || ''
  const sample = stripAnsi(source).trim()
  const first = sample.split('\n', 1)[0] || 'Unknown error'
  // A Playwright assertion opens with the same line for every failure of a matcher
  // (`expect(locator).toHaveText(expected) failed`): its locator is what tells two apart.
  const locator = /^Locator:\s*(\S.*)$/m.exec(sample)?.[1]?.trim()
  const title = (locator && !first.includes(locator) ? `${first} · ${locator}` : first).slice(0, 140)
  return { fingerprint: hash(normalizeErrorMessage(source)), title, sample }
}

// Group failing occurrences across a project's run reports by error signature.
// Reads only data already on the reports (errors jsonb), so it costs nothing at ingest.
export function buildFailureClusters(reports: RunReport[]): FailureCluster[] {
  interface Acc {
    fingerprint: string
    title: string
    sample: string
    count: number
    testKeys: Set<string>
    files: Set<string>
    lastSeen: number
  }
  const byFp = new Map<string, Acc>()

  for (const report of reports) {
    const ts = Date.parse(report.startedAt)
    for (const t of report.tests) {
      if (t.status !== 'unexpected' && t.status !== 'flaky')
        continue
      const err = t.errors[0]
      if (!err)
        continue
      const { fingerprint, title, sample } = fingerprintError(err)
      let c = byFp.get(fingerprint)
      if (!c) {
        c = { fingerprint, title, sample, count: 0, testKeys: new Set(), files: new Set(), lastSeen: 0 }
        byFp.set(fingerprint, c)
      }
      c.count++
      c.testKeys.add(t.testKey)
      c.files.add(t.file)
      // Freshest occurrence is the representative shown in the UI.
      if (ts >= c.lastSeen) {
        c.lastSeen = ts
        c.title = title
        c.sample = sample
      }
    }
  }

  return [...byFp.values()]
    .map(c => ({
      fingerprint: c.fingerprint,
      title: c.title,
      sample: c.sample,
      count: c.count,
      tests: c.testKeys.size,
      testKeys: [...c.testKeys],
      files: [...c.files],
      lastSeen: new Date(c.lastSeen).toISOString(),
    }))
    .sort(byClusterImpact)
}

// Widest blast radius first: distinct tests, then occurrences, then recency.
export function byClusterImpact(a: FailureCluster, b: FailureCluster): number {
  return b.tests - a.tests || b.count - a.count || b.lastSeen.localeCompare(a.lastSeen)
}
