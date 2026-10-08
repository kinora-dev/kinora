// Both ingest paths read the FINAL attempt's attachments, but Playwright's common
// `trace: 'on-first-retry'` records the trace on an EARLIER attempt - so a failing test
// (which retries to a traceless final attempt) would lose its trace. Surface the most
// recent trace from any attempt when the final attempt has none.

interface RawAttachment {
  name: string
  contentType: string
  path?: string
}

function isTraceLike(a: RawAttachment): boolean {
  return a.name === 'trace' || a.contentType === 'application/zip' || (a.path?.endsWith('.zip') ?? false)
}

export function effectiveAttachments<A extends RawAttachment>(
  results: ReadonlyArray<{ attachments?: A[] }>,
): A[] {
  const last = results.at(-1)?.attachments ?? []
  if (last.some(isTraceLike))
    return last
  const trace = results.flatMap(r => r.attachments ?? []).filter(isTraceLike).at(-1)
  return trace ? [...last, trace] : last
}

// A failed `toHaveScreenshot` / `toMatchSnapshot` attaches up to four images named after the
// snapshot: `<name>-expected.png`, `<name>-actual.png`, `<name>-diff.png`, and `<name>-previous.png`
// when the page never settled. Passing assertions attach nothing.
const SNAPSHOT_PARTS = ['expected', 'actual', 'diff', 'previous'] as const
type SnapshotPart = typeof SNAPSHOT_PARTS[number]
const SNAPSHOT_NAME = new RegExp(`^(.+)-(${SNAPSHOT_PARTS.join('|')})(\\.\\w+)?$`)

export type ScreenshotComparison<A> = { name: string } & Partial<Record<SnapshotPart, A>>

// Split a test's attachments into its screenshot comparisons and everything else. A comparison
// needs the `actual` image (the only part always written); a lone `expected` stays in `rest`.
export function splitScreenshotComparisons<A extends { name: string, contentType: string }>(
  attachments: readonly A[],
): { comparisons: ScreenshotComparison<A>[], rest: A[] } {
  const groups: ScreenshotComparison<A>[] = []
  const members = new Map<A, ScreenshotComparison<A>>()
  for (const a of attachments) {
    const match = a.contentType.startsWith('image/') ? SNAPSHOT_NAME.exec(a.name) : null
    if (!match)
      continue
    const name = `${match[1]}${match[3] ?? ''}`
    const part = match[2] as SnapshotPart
    // A second image for a slot already taken starts a new comparison of the same name.
    let group = groups.findLast(g => g.name === name)
    if (!group || group[part]) {
      group = { name } as ScreenshotComparison<A>
      groups.push(group)
    }
    group[part] = a
    members.set(a, group)
  }
  const comparisons = groups.filter(g => g.actual)
  return { comparisons, rest: attachments.filter(a => !comparisons.includes(members.get(a)!)) }
}
