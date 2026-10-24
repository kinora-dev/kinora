import type { Attachment } from '@isomorphic/trace/traceModel'

export interface ImageDiffGroup {
  name: string
  expected?: Attachment
  actual?: Attachment
  diff?: Attachment
}

const DIFF_RE = /^(.*)-(expected|actual|diff)\.png$/

// Groups Playwright's `<name>-{expected,actual,diff}.png` screenshot triplets;
// incomplete groups (missing expected or actual) stay in `rest` as plain attachments.
// Unlike upstream, a triplet is grouped per step, so two assertions on the same name stay apart.
export function groupImageDiffs(attachments: Attachment[]): { diffs: ImageDiffGroup[], rest: Attachment[] } {
  const groups = new Map<string, ImageDiffGroup>()
  const order: string[] = []
  for (const att of attachments) {
    const m = att.name.match(DIFF_RE)
    if (!m)
      continue
    const [, name, type] = m
    const key = `${att.callId}\0${name}`
    let g = groups.get(key)
    if (!g) {
      g = { name }
      groups.set(key, g)
      order.push(key)
    }
    g[type as 'expected' | 'actual' | 'diff'] = att
  }

  const diffs: ImageDiffGroup[] = []
  const used = new Set<Attachment>()
  for (const key of order) {
    const g = groups.get(key)!
    if (!g.expected || !g.actual)
      continue
    diffs.push(g)
    used.add(g.expected).add(g.actual)
    if (g.diff)
      used.add(g.diff)
  }

  return { diffs, rest: attachments.filter(a => !used.has(a)) }
}
