import type { PwTestStatus } from '@kinora/core'

// Human label for a test row: the suite path + title without the leading file. titlePath[0] is the
// file (shown separately in the UI), so drop it; fall back to the title when there's no suite hierarchy.
export function testLabel(t: { titlePath: string[], title: string }): string {
  return t.titlePath.slice(1).join(' › ') || t.title
}

const SEVERITY: Record<PwTestStatus, number> = { unexpected: 0, flaky: 1, skipped: 2, expected: 3 }

// Failures first, so a large run opens on what broke. Stable: keeps the reported order within a status.
export function bySeverity<T extends { status: PwTestStatus }>(tests: readonly T[]): T[] {
  return [...tests].sort((a, b) => SEVERITY[a.status] - SEVERITY[b.status])
}
