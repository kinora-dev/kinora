// Demo data for the film, DOM-free so the soundtrack can read it too.
// Names and numbers mirror the kinora demo workspace (db:seed).
import { advanceBirth, ADVANCES, CUE, stripBirth } from './timing.js'

export const SLOTS = 20

const STATUS = { P: 'pass', A: 'flaky', F: 'fail' }
// A failing run keeps most of its suite green, so its bar is shorter, not empty.
// How many tests fail cycles through these, so pass rates stay real fractions.
const FAILED_TESTS = [2, 1, 3]

function runs(pattern, tests) {
  let fails = 0
  return [...pattern].map((ch) => {
    const status = STATUS[ch]
    return { status, pct: status === 'fail' ? (tests - FAILED_TESTS[fails++ % FAILED_TESTS.length]) / tests : 1 }
  })
}

// `first` is the strip as it stands when a project appears, `then` are the runs
// that arrive while time advances. Grid order: two rows of three.
const SEED = [
  { name: 'Admin Dashboard', tests: 6, took: '3.7s', ago: '3h ago', first: 'PPPPPPPPAPPPPPPPPPPP', then: 'PPPPPPAPPPPPPPPPPPAPPPPPPPPP' },
  // The hero project. When time stops, its last 20 runs hold exactly three flaky
  // ones (the newest lands on the bar-5 downbeat), then a failing run arrives on cue.
  { name: 'Checkout API', tests: 7, took: '5.6s', ago: 'just now', first: 'PPPPPAPPPPFFPPPAPPPP', then: 'PPPAPPPPPPPPPPPAPPPPAPPPPPPAF', hero: true },
  { name: 'Mobile App', tests: 8, took: '9.0s', ago: '3h ago', first: 'APPAPPFPPPAPPPAPPPPA', then: 'PPAPPPPAPPPAPPPAPPAPPPPAPPPA' },
  { name: 'Marketing Site', tests: 6, took: '7.7s', ago: '4h ago', first: 'PPPAPPPPPPPPPAPPPPPP', then: 'PPPPPPPPPPAPPPPPPPPPPPPPAPPP' },
  { name: 'API Gateway', tests: 7, took: '10.5s', ago: '3h ago', first: 'PPFPPPAPPFPPPAPFPPAF', then: 'FPPPAPPFPPPPAPPFPPPAPPPFPPAF' },
  { name: 'Web App', tests: 8, took: '10.5s', ago: '2h ago', first: 'APPAPPPAAPPPAPPPAPAA', then: 'PAPPAPPPAPAPPAPAPPAPPAPAPPPA' },
]

export const HERO = SEED.findIndex(p => p.hero)

// Neighbours run a hair behind the hero so the wall advances as a wave.
const LAG = [0.030, 0, 0.018, 0.048, 0.024, 0.040]

export const PROJECTS = SEED.map((seed, i) => {
  const all = runs(seed.first + seed.then, seed.tests)
  // When each run after the first 20 lands.
  const arrivals = [...seed.then].map((_, k) => (k < ADVANCES ? advanceBirth(k) + LAG[i] : CUE.fail))
  return { ...seed, index: i, col: i % 3, row: Math.floor(i / 3), runs: all, arrivals }
})

export const HERO_RUNS = PROJECTS[HERO].runs
/** Hero runs that get called out as flaky in bar 5 (indices into HERO_RUNS). */
export const HERO_FLAKY = [35, 40, 47]
/** The failing run the camera dives into. */
export const HERO_FAIL = 48

/** How many runs past the first 20 a project has received at time `t`. */
export function arrived(project, t) {
  let n = 0
  while (n < project.arrivals.length && t >= project.arrivals[n])
    n++
  return n
}

/** Pass rate over the last 20 runs, given `n` arrivals. */
export function passRate(project, n) {
  let sum = 0
  for (let j = n; j < n + SLOTS; j++)
    sum += project.runs[j].pct
  return sum / SLOTS
}

export function formatPct(rate) {
  return `${(rate * 100).toFixed(1)}%`
}

/** Sound cue list for the first strip: one event per recorded run. */
export function stripEvents() {
  return HERO_RUNS.slice(0, SLOTS).map((run, i) => ({ at: stripBirth(i), status: run.status, index: i }))
}

// ---- Trace ---------------------------------------------------------------

// The action list of the demo trace (checkout.spec.ts › completes checkout).
// `seg` is the action's span on the timeline in percent, `frame` the snapshot
// the viewer shows while it is selected.
export const ACTIONS = [
  { title: 'Before Hooks', took: '105ms', depth: 0, group: true },
  { title: 'Fixture "browser"', took: '66ms', depth: 1, group: true },
  { title: 'Launch browser', took: '65ms', depth: 2 },
  { title: 'Fixture "context"', took: '6ms', depth: 1, group: true },
  { title: 'Create context', took: '3ms', depth: 2 },
  { title: 'Fixture "page"', took: '30ms', depth: 1, group: true },
  { title: 'Create page', took: '30ms', depth: 2, status: 'ok', seg: [10, 15], frame: 0, at: '105ms' },
  { title: 'Route requests', took: '1ms', depth: 0, status: 'ok', seg: [15.5, 17.5], frame: 1, at: '136ms' },
  { title: 'Route requests', took: '0ms', depth: 0, status: 'ok', seg: [18, 20], frame: 2, at: '138ms' },
  { title: 'Set content', took: '17ms', depth: 0, status: 'ok', seg: [20.5, 26.5], frame: 3, at: '139ms' },
  { title: 'Fulfill request', took: '3ms', depth: 0, status: 'ok', seg: [27, 29.5], frame: 4, at: '141ms' },
  { title: 'Fulfill request', took: '2ms', depth: 0, status: 'ok', seg: [30, 32.5], frame: 5, at: '144ms' },
  { title: 'Fill "alex@example.com"', took: '17ms', depth: 0, status: 'ok', seg: [33, 41], frame: 6, at: '157ms' },
  { title: 'Click', took: '25ms', depth: 0, status: 'ok', seg: [41.5, 52], frame: 7, at: '175ms' },
  { title: 'Expect "toHaveText"', took: '1.5s', depth: 0, status: 'error', seg: [52.5, 97], frame: 8, at: '201ms' },
  { title: 'After Hooks', took: '13ms', depth: 0, group: true },
  { title: 'Fixture "page"', took: '0ms', depth: 1 },
  { title: 'Fixture "context"', took: '11ms', depth: 1, group: true },
  { title: 'Close context', took: '2ms', depth: 2 },
]

export const FIRST_ACTION = ACTIONS.findIndex(a => a.seg)
export const ERROR_ACTION = ACTIONS.findIndex(a => a.status === 'error')
export const FRAMES = ACTIONS[ERROR_ACTION].frame + 1

function inOutCubic(p) {
  return p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2
}

/** Playhead position on the trace timeline, in percent. */
export function headAt(t) {
  const [from, to] = CUE.scrub
  const p = Math.min(1, Math.max(0, (t - from) / (to - from)))
  const start = ACTIONS[FIRST_ACTION].seg[0]
  const end = ACTIONS[ERROR_ACTION].seg[0]
  return start + (end - start) * inOutCubic(p)
}

/** Index into ACTIONS of the action under the playhead. */
export function actionAt(t) {
  const head = headAt(t) + 0.4
  let current = FIRST_ACTION
  for (let i = FIRST_ACTION; i <= ERROR_ACTION; i++) {
    if (head >= ACTIONS[i].seg[0])
      current = i
  }
  return current
}

/** When the playhead reaches each scrubbed action (the snapshot flips then). */
export const FLIP_TIMES = (() => {
  const [from, to] = CUE.scrub
  const times = []
  for (let i = FIRST_ACTION + 1; i <= ERROR_ACTION; i++) {
    let lo = from
    let hi = to
    for (let n = 0; n < 40; n++) {
      const mid = (lo + hi) / 2
      if (actionAt(mid) >= i)
        hi = mid
      else
        lo = mid
    }
    times.push(hi)
  }
  return times
})()
