import type { NormTest, TestHistory, TestPoint } from '../contracts/kinora'

// Annotation type stamped on a test for each component story it mounts (Playwright's
// `mount` fixture). Annotations ride both ingest paths untouched, so the story id
// reaches the dashboard without a dedicated field.
export const STORY_ANNOTATION = 'kinora:story'

// Distinct story ids a test mounted. Deduped here too: annotations can repeat across retries.
export function storiesOf(test: Pick<NormTest, 'annotations'>): string[] {
  const ids = test.annotations.flatMap(a => (a.type === STORY_ANNOTATION && a.description ? [a.description] : []))
  return [...new Set(ids)]
}

export interface StoryHealth {
  /** Full story id, e.g. `components/Button/Primary`. */
  id: string
  /** Last segment of the id, e.g. `Primary`. */
  name: string
  tests: TestHistory[]
  /** One point per run in which any of the story's tests ran, oldest first. */
  points: TestPoint[]
  lastStatus: TestPoint['status']
}

export interface ComponentHealth {
  /** Story id minus its last segment, e.g. `components/Button`. Empty for a single-segment id. */
  path: string
  /** Last segment of `path`, e.g. `Button`. Empty for a single-segment id. */
  name: string
  stories: StoryHealth[]
  lastStatus: TestPoint['status']
}

// Worst first, so one failing test is enough to mark its story (and component) as failing.
const SEVERITY: TestPoint['status'][] = ['unexpected', 'flaky', 'expected', 'skipped']

function worst(statuses: TestPoint['status'][]): TestPoint['status'] {
  return SEVERITY.find(s => statuses.includes(s)) ?? 'skipped'
}

// Playwright accepts any unique suffix of a story id (`mount('Button/Primary')` for
// `components/Button/Primary`), so two tests can name one story differently. Map each id to
// the longest id it is a suffix of; an ambiguous suffix (several candidates) is left as is.
function canonicalIds(ids: string[]): Map<string, string> {
  const canonical = new Map<string, string>()
  for (const id of ids) {
    const longer = ids.filter(other => other.endsWith(`/${id}`))
    const longest = longer.filter(a => longer.every(b => a === b || a.endsWith(`/${b}`)))
    canonical.set(id, longest.length === 1 ? longest[0] : id)
  }
  return canonical
}

// Fold the tests of a story into one timeline: per run, the worst status among them.
function storyPoints(tests: TestHistory[]): TestPoint[] {
  const byRun = new Map<string, TestPoint[]>()
  for (const t of tests) {
    for (const p of t.points)
      byRun.set(p.runId, [...(byRun.get(p.runId) ?? []), p])
  }
  return [...byRun.values()]
    .map(points => ({
      runId: points[0].runId,
      startedAt: points[0].startedAt,
      status: worst(points.map(p => p.status)),
      duration: points.reduce((sum, p) => sum + p.duration, 0),
      retries: points.reduce((sum, p) => sum + p.retries, 0),
    }))
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
}

// Group test histories by the component stories they mount, for the Components view.
//
// A test that mounts several stories counts for each of them: we only know which stories a
// test mounted, not which one an assertion failed on. So a failure of such a test marks all
// of its stories as failing, including ones that rendered fine.
export function buildComponents(histories: TestHistory[]): ComponentHealth[] {
  const mounted = histories.filter(h => h.stories?.length)
  const canonical = canonicalIds([...new Set(mounted.flatMap(h => h.stories ?? []))])

  const testsByStory = new Map<string, Set<TestHistory>>()
  for (const h of mounted) {
    for (const raw of h.stories ?? []) {
      const id = canonical.get(raw) ?? raw
      testsByStory.set(id, (testsByStory.get(id) ?? new Set()).add(h))
    }
  }

  const byPath = new Map<string, StoryHealth[]>()
  for (const [id, set] of testsByStory) {
    const tests = [...set]
    const points = storyPoints(tests)
    const cut = id.lastIndexOf('/')
    const path = cut === -1 ? '' : id.slice(0, cut)
    const story: StoryHealth = { id, name: id.slice(cut + 1), tests, points, lastStatus: points.at(-1)?.status ?? 'skipped' }
    byPath.set(path, [...(byPath.get(path) ?? []), story])
  }

  return [...byPath]
    .map(([path, stories]) => ({
      path,
      name: path.slice(path.lastIndexOf('/') + 1),
      stories: stories.sort((a, b) => a.name.localeCompare(b.name)),
      lastStatus: worst(stories.map(s => s.lastStatus)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path))
}
