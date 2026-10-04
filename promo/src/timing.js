// The film is cut on a 128 BPM grid: 32 beats = 8 bars = exactly 15 seconds.
// Picture (film.js) and soundtrack (../audio.mjs) both read their cues from
// here, so a hit you see is always the hit you hear.
export const FPS = 60
export const BPM = 128
export const BEAT = 60 / BPM
export const DURATION = 32 * BEAT

/** Beats to seconds. */
export function b(beats) {
  return beats * BEAT
}

// Every cue is in seconds. Ranges are [start, end].
export const CUE = {
  // Bar 1: the record dot, then it writes the headline.
  pop: b(0),
  pulse: b(0.75),
  toLine: [b(1.25), b(2)],
  writeLine1: [b(2), b(3.75)],
  // Line feed + carriage return, like a print head.
  carriage: [b(3.75), b(4.25)],
  // Bar 2: the dot records 20 runs, one per 32nd note.
  stripFirst: b(4.5),
  stripEvery: b(1 / 8),
  // Bar 3: pull back to every project. Camera moves start a touch early so
  // their fastest frame, not their first, lands on the beat.
  pullBack: [b(8) - 0.15, b(8) + 0.9],
  writeLine2: [b(9), b(10)],
  // Bar 4: "and over time." (the runs themselves arrive on advanceBirth).
  writeLine3: [b(12), b(13)],
  eraseHeadline: [b(15.25), b(16)],
  // Bar 5: push in on one project, surface its flaky runs.
  pushIn: [b(16) - 0.15, b(16) + 0.75],
  writeFlaky: [b(16.5), b(17.5)],
  spotlight: [b(16.25), b(16.75)],
  flicker: b(16.5),
  locks: [b(18), b(18.5), b(19)],
  eraseFlaky: [b(19.5), b(20.15)],
  // Bar 6: a failing run lands, the camera dives into it.
  fail: b(20),
  diveBack: [b(20.75), b(21.25)],
  dive: [b(21.25), b(22)],
  emerge: [b(22), b(23.5)],
  writeTrace: [b(22.75), b(23.85)],
  // Bar 7: scrub the trace, snapshots riffle like a flip book.
  headIn: b(22.9),
  scrub: [b(23.5), b(25.5)],
  lock: b(25.5),
  eraseTrace: [b(26.6), b(27.25)],
  // Bar 8: everything folds back into the dot, which signs the film.
  collapse: [b(27), b(28)],
  logo: b(28),
  writeLogo: [b(28), b(28.75)],
  tagline: [b(28.6), b(29.4)],
  url: [b(29.1), b(29.7)],
  lastPulse: b(30),
}

/** When the dot writes bar `i` of the first strip. */
export function stripBirth(i) {
  return CUE.stripFirst + i * CUE.stripEvery
}

// Once the wall is up, runs keep arriving and time speeds up into bar 5:
// four on 8th notes, eight on 16ths, sixteen on 32nds.
export const ADVANCES = 28

/** When run `k` (0-based) arrives while time is advancing. */
export function advanceBirth(k) {
  if (k < 4)
    return b(10 + k / 2)
  if (k < 12)
    return b(12 + (k - 4) / 4)
  return b(14 + (k - 12) / 8)
}
