// Synthesizes the film's soundtrack, sample by sample, from the same cue
// sheet the picture runs on (src/timing.js) and the same data (src/data.js):
// every recorded run is a note, every camera move a breath of noise, and the
// dot has one voice, a small bell, wherever it lands.
//
// No samples, no dependencies: oscillators, noise, a filter, a reverb.
import { Buffer } from 'node:buffer'
import { writeFile } from 'node:fs/promises'
import { FLIP_TIMES, HERO, HERO_FLAKY, HERO_RUNS, PROJECTS, SLOTS, stripEvents } from './src/data.js'
import { hash } from './src/ease.js'
import { advanceBirth, ADVANCES, b, CUE, DURATION, stripBirth } from './src/timing.js'

const SR = 48000
const TAU = Math.PI * 2

/** MIDI note number to Hz. */
function hz(note) {
  return 440 * 2 ** ((note - 69) / 12)
}

// A minor pentatonic from A3: any run of these sounds like a phrase.
const PENTATONIC = [0, 3, 5, 7, 10]
function scale(degree) {
  return hz(57 + 12 * Math.floor(degree / 5) + PENTATONIC[degree % 5])
}

function noise(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 2147483648 - 1
  }
}

function createBus() {
  const n = Math.ceil(DURATION * SR)
  return { n, l: new Float32Array(n), r: new Float32Array(n), sendL: new Float32Array(n), sendR: new Float32Array(n) }
}

/** Writes one mono voice into a bus. `pan` is -1..1 (or a function of the voice's progress), `send` feeds the reverb. */
function voice(bus, at, dur, gain, pan, send, sample) {
  const start = Math.round(at * SR)
  const count = Math.round(dur * SR)
  for (let i = 0; i < count; i++) {
    const j = start + i
    if (j < 0 || j >= bus.n)
      continue
    const where = typeof pan === 'function' ? pan(i / count) : pan
    const v = sample(i / SR, i / count) * gain
    const l = v * Math.cos((where + 1) * Math.PI / 4)
    const r = v * Math.sin((where + 1) * Math.PI / 4)
    bus.l[j] += l
    bus.r[j] += r
    bus.sendL[j] += l * send
    bus.sendR[j] += r * send
  }
}

// ---- Voices ---------------------------------------------------------------

/** The dot's voice: a small bell with two inharmonic partials. */
function ping(bus, at, freq, gain = 0.24, pan = 0, decay = 0.42) {
  voice(bus, at, decay * 7, gain, pan, 0.7, (t) => {
    const strike = Math.min(1, t / 0.002)
    return strike * (
      Math.sin(TAU * freq * t) * Math.exp(-t / decay)
      + 0.32 * Math.sin(TAU * freq * 2.76 * t) * Math.exp(-t / (decay * 0.3))
      + 0.1 * Math.sin(TAU * freq * 5.4 * t) * Math.exp(-t / (decay * 0.12))
    )
  })
}

/** A run being recorded: a short, soft mallet note. */
function pluck(bus, at, freq, gain = 0.15, pan = 0, decay = 0.07, send = 0.3) {
  voice(bus, at, decay * 8, gain, pan, send, (t) => {
    const strike = Math.min(1, t / 0.0015) * Math.exp(-t / decay)
    return strike * (Math.sin(TAU * freq * t) + 0.3 * Math.sin(TAU * 2 * freq * t) + 0.1 * Math.sin(TAU * 3 * freq * t))
  })
}

function kick(bus, at, gain = 0.7, { decay = 0.2, floor = 46, punch = 110 } = {}) {
  let phase = 0
  voice(bus, at, decay * 7, gain, 0, 0.04, (t) => {
    phase += TAU * (floor + punch * Math.exp(-t / 0.028)) / SR
    return Math.min(1, t / 0.0008) * Math.exp(-t / decay) * Math.sin(phase)
  })
}

// State-variable filter: cheap, and happy to have its cutoff swept every sample.
function filter() {
  let low = 0
  let band = 0
  return (x, cutoff, q) => {
    const f = 2 * Math.sin(Math.PI * Math.min(cutoff, SR / 6.5) / SR)
    low += f * band
    const high = x - low - q * band
    band += f * high
    return band
  }
}

/** Band-passed noise whose centre sweeps from `f0` to `f1`: every camera move. */
function whoosh(bus, at, dur, f0, f1, gain, { shape = p => Math.sin(Math.PI * p) ** 2, pan = 0, q = 0.7, seed = 1, send = 0.35 } = {}) {
  const white = noise(seed)
  const band = filter()
  voice(bus, at, dur, gain, pan, send, (t, p) => band(white(), f0 * (f1 / f0) ** p, q) * shape(p))
}

/** A snapshot card flicking over. */
function flick(bus, at, gain = 0.16, pan = 0, seed = 1) {
  const white = noise(seed)
  const band = filter()
  voice(bus, at, 0.12, gain, pan, 0.2, t => band(white(), 3200 * Math.exp(-t / 0.05) + 900, 0.9) * Math.min(1, t / 0.0006) * Math.exp(-t / 0.022))
}

/** A soft sustained chord. `bright` (0..1 over the chord's life) opens it up. */
function pad(bus, at, dur, notes, gain, { attack = 0.9, release = 1.1, bright = () => 0.5 } = {}) {
  notes.forEach((note, k) => {
    for (const cents of [-6, 6]) {
      const freq = hz(note) * 2 ** (cents / 1200)
      const pan = (k / (notes.length - 1) - 0.5) * 1.2 * Math.sign(cents)
      voice(bus, at, dur, gain / notes.length, pan, 0.35, (t, p) => {
        const level = Math.min(1, t / attack) * Math.min(1, (dur - t) / release)
        const open = bright(p)
        let s = 0
        for (let h = 1; h <= 7; h++)
          s += Math.sin(TAU * freq * h * t + k * h) * h ** -1.3 * open ** (h - 1)
        return level * s
      })
    }
  })
}

/** A struck chord that rings out: the logo. */
function chord(bus, at, notes, gain, decay = 1.5) {
  notes.forEach((note, k) => {
    const freq = hz(note)
    voice(bus, at, decay * 5, gain / notes.length, (k / (notes.length - 1) - 0.5) * 1.1, 0.7, (t) => {
      let s = 0
      for (let h = 1; h <= 6; h++)
        s += Math.sin(TAU * freq * h * t) * h ** -1.5 * Math.exp(-t * h * 0.35)
      return Math.min(1, t / 0.006) * Math.exp(-t / decay) * s
    })
  })
}

/** Something went wrong: two close, low notes sagging in pitch. */
function thud(bus, at, gain, note = 45) {
  for (const [offset, level] of [[0, 1], [1, 0.55]]) {
    const freq = hz(note + offset)
    let phase = 0
    voice(bus, at, 0.7, gain, 0, 0.25, (t) => {
      phase += TAU * freq * (1 - 0.06 * Math.min(1, t / 0.25)) / SR
      const saw = Math.sin(phase) + 0.5 * Math.sin(2 * phase) + 0.33 * Math.sin(3 * phase) + 0.2 * Math.sin(4 * phase)
      return level * Math.min(1, t / 0.003) * Math.exp(-t / 0.16) * saw
    })
  }
}

// ---- Reverb (Freeverb's layout: parallel combs into serial allpasses) -------

function reverb(inL, inR, { room = 0.84, damp = 0.28, spread = 23 } = {}) {
  const k = SR / 44100
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617]
  const allpasses = [556, 441, 341, 225]
  const tank = (input, shift) => {
    const out = new Float32Array(input.length)
    for (const size of combs) {
      const buf = new Float32Array(Math.round((size + shift) * k))
      let pos = 0
      let store = 0
      for (let i = 0; i < input.length; i++) {
        const y = buf[pos]
        store = y * (1 - damp) + store * damp
        buf[pos] = input[i] * 0.015 + store * room
        pos = (pos + 1) % buf.length
        out[i] += y
      }
    }
    for (const size of allpasses) {
      const buf = new Float32Array(Math.round((size + shift) * k))
      let pos = 0
      for (let i = 0; i < out.length; i++) {
        const y = buf[pos]
        buf[pos] = out[i] + y * 0.5
        out[i] = y - out[i]
        pos = (pos + 1) % buf.length
      }
    }
    return out
  }
  return [tank(inL, 0), tank(inR, spread)]
}

// ---- The score ------------------------------------------------------------

function score() {
  const fx = createBus()
  const music = createBus()
  const kicks = []
  const beat = (at, gain, shape) => {
    kicks.push(at)
    kick(fx, at, gain, shape)
  }

  // Bar 1. The record light comes on; the dot darts off and writes the headline.
  kick(fx, CUE.pop, 0.7, { decay: 0.34, floor: 42 })
  ping(fx, CUE.pop, hz(81), 0.3)
  ping(fx, CUE.pulse, hz(76), 0.13)
  whoosh(fx, CUE.toLine[0], 0.42, 600, 2600, 0.1, { seed: 2 })
  const [w0, w1] = CUE.writeLine1
  for (let i = 0; w0 + i * b(1 / 8) < w1; i++)
    pluck(fx, w0 + i * b(1 / 8), hz(93) * (1 + 0.02 * (i % 3)), 0.035 + 0.02 * Math.sin(Math.PI * i / 14), -0.5 + i / 14, 0.012, 0.15)
  pad(music, w0, CUE.pullBack[0] - w0 + 0.6, [57, 64, 69], 0.11, { attack: 1.4, release: 0.6, bright: p => 0.3 + 0.15 * p })
  whoosh(fx, CUE.carriage[0], 0.3, 3200, 500, 0.12, { seed: 3, pan: p => 0.5 - p })

  // Bar 2. Twenty runs, one per 32nd note: a rising run with the failures as a dip.
  for (const { at, status, index } of stripEvents()) {
    const pan = -0.55 + 1.1 * index / (SLOTS - 1)
    const freq = scale((index % 4) + Math.floor(index / 4))
    if (status === 'fail') {
      pluck(fx, at, freq / 4, 0.3, pan, 0.09, 0.2)
      flick(fx, at, 0.08, pan, 40 + index)
    }
    else {
      pluck(fx, at, freq, 0.17, pan)
      if (status === 'flaky')
        pluck(fx, at, freq * 2 ** (1 / 12), 0.09, pan)
    }
  }
  ping(fx, stripBirth(SLOTS - 1) + b(1 / 8), hz(76), 0.2, 0.5)

  // Bar 3. The camera snaps back to every project.
  const hit = b(8)
  whoosh(fx, hit - b(1), b(1), 300, 5200, 0.17, { shape: p => p ** 2.4, seed: 4 })
  beat(hit, 0.95, { decay: 0.5, floor: 38, punch: 90 })
  whoosh(fx, hit, 1.0, 6000, 350, 0.2, { shape: p => (1 - p) ** 2.2, seed: 5 })
  pad(music, hit - 0.3, b(16) - hit + 1.2, [57, 60, 64, 67, 71], 0.25, { attack: 0.5, release: 1.0, bright: p => 0.42 + 0.3 * p })
  PROJECTS.filter(p => p.index !== HERO).forEach((project, i) => {
    const dist = Math.hypot(project.col - PROJECTS[HERO].col, project.row - PROJECTS[HERO].row)
    pluck(fx, CUE.pullBack[0] + 0.5 + dist * 0.08 + i * 0.012, scale(9 - i), 0.12, (project.col - 1) * 0.6, 0.12, 0.5)
  })

  // Bars 3 and 4. Runs keep arriving and time speeds up: 8ths, 16ths, 32nds.
  for (let k = 0; k < ADVANCES; k++) {
    const at = advanceBirth(k)
    const flaky = HERO_RUNS[SLOTS + k].status === 'flaky'
    const lift = k < 12 ? 0 : (k - 12) / 16
    pluck(fx, at, scale(5 + (k % 4) + Math.floor(k / 8)) * (flaky ? 2 ** (1 / 12) : 1), 0.1 + 0.07 * lift, 0.35, 0.06, 0.3)
  }
  for (let n = 10; n < 16; n++)
    beat(b(n), n < 12 ? 0.5 : 0.62, { decay: 0.17 })
  for (let n = 12; n < 16; n += 0.5)
    flick(fx, b(n + 0.25), 0.05, n % 1 ? 0.3 : -0.3, 60 + n * 2)
  whoosh(fx, b(14), b(2), 500, 6500, 0.16, { shape: p => p ** 2.2, seed: 6 })
  for (let n = 10; n < 16; n += 0.5)
    pluck(music, b(n), hz(33), 0.34, 0, 0.14, 0.03)

  // Bar 5. Push in; the rhythm drops out and three runs cannot make up their minds.
  beat(b(16), 0.95, { decay: 0.5, floor: 38, punch: 90 })
  whoosh(fx, b(16), 0.8, 5000, 300, 0.16, { shape: p => (1 - p) ** 2, seed: 7 })
  pad(music, b(16) - 0.2, b(20) - b(16) + 0.6, [52, 57, 62], 0.17, { attack: 0.4, release: 0.5, bright: p => 0.36 + 0.14 * p })
  HERO_FLAKY.forEach((run, i) => {
    const lock = CUE.locks[i]
    const pan = -0.3 + 0.45 * i
    // The same dice the picture rolls for the flicker, so the stutter is heard.
    let was = false
    for (let tick = Math.ceil(CUE.flicker * 30); tick / 30 < lock; tick++) {
      const urgency = (tick / 30 - CUE.flicker) / (lock - CUE.flicker)
      const on = hash(tick * 3.17 + run * 11.3) < 0.2 + urgency * 0.65
      if (on && !was)
        pluck(fx, tick / 30, hash(tick * 7.31 + run) < 0.5 ? hz(88) : hz(82), 0.035 + 0.03 * urgency, pan, 0.012, 0.2)
      was = on
    }
    ping(fx, lock, scale(7 + i), 0.2, pan, 0.26)
    flick(fx, lock - 0.03, 0.09, pan, 80 + i)
  })

  // Bar 6. A failing run lands; the camera dives into it and comes out in its trace.
  kick(fx, CUE.fail, 0.9, { decay: 0.4, floor: 36, punch: 70 })
  thud(fx, CUE.fail, 0.26)
  whoosh(fx, CUE.fail, 0.5, 900, 120, 0.2, { shape: p => (1 - p) ** 1.5, q: 0.5, seed: 8 })
  const [dv0, dv1] = CUE.dive
  whoosh(fx, CUE.diveBack[0], dv1 - CUE.diveBack[0], 250, 6800, 0.26, { shape: p => p ** 3, seed: 9 })
  let rise = 0
  voice(fx, dv0 - 0.2, dv1 - dv0 + 0.2, 0.1, 0, 0.5, (t, p) => {
    rise += TAU * hz(45) * 8 ** (p ** 2) / SR
    return p ** 2.5 * Math.sin(rise)
  })
  beat(dv1, 1, { decay: 0.6, floor: 36, punch: 80 })
  whoosh(fx, dv1, 1.1, 7000, 300, 0.24, { shape: p => (1 - p) ** 2.4, seed: 10 })
  pad(music, dv1 - 0.05, CUE.collapse[0] - dv1 + 0.7, [53, 57, 60, 64], 0.22, { attack: 0.25, release: 0.9, bright: p => 0.62 - 0.12 * p })
  ping(fx, CUE.headIn, hz(81), 0.16, 0.2, 0.3)

  // Bar 7. The playhead scrubs; each snapshot flicks over, a step up the scale.
  FLIP_TIMES.forEach((at, i) => {
    flick(fx, at, 0.17, 0.35, 100 + i)
    pluck(fx, at, scale(4 + i), 0.08, 0.35, 0.05)
  })
  thud(fx, CUE.lock, 0.3, 40)
  kick(fx, CUE.lock, 0.6, { decay: 0.3, floor: 40, punch: 60 })

  // Bar 8. Everything folds back into the dot, and the dot signs the film.
  const logo = CUE.logo
  whoosh(fx, CUE.collapse[0], logo - CUE.collapse[0], 300, 6000, 0.2, { shape: p => p ** 2.6, seed: 11 })
  beat(logo, 1, { decay: 0.7, floor: 34, punch: 80 })
  chord(fx, logo, [36, 48, 55, 64, 67, 74], 0.75, 1.0)
  ping(fx, logo, hz(88), 0.22, 0, 0.7)
  ping(fx, logo + b(0.75), hz(91), 0.1, 0.3, 0.6)
  whoosh(fx, logo, 0.8, 4000, 9000, 0.05, { shape: p => Math.sin(Math.PI * p), seed: 12, pan: p => -0.5 + p })
  ping(fx, CUE.lastPulse, hz(79), 0.11, -0.2, 0.6)

  return { fx, music, kicks }
}

function master({ fx, music, kicks }) {
  const n = fx.n
  // The pad ducks under every kick, so the low end stays clear and the film breathes on the beat.
  const duck = new Float32Array(n).fill(1)
  for (const at of kicks) {
    for (let i = Math.round(at * SR); i < n && i < (at + 0.5) * SR; i++)
      duck[i] = Math.min(duck[i], 1 - 0.55 * Math.exp(-(i / SR - at) / 0.13))
  }
  const sendL = new Float32Array(n)
  const sendR = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    sendL[i] = fx.sendL[i] + music.sendL[i] * duck[i]
    sendR[i] = fx.sendR[i] + music.sendR[i] * duck[i]
  }
  const [wetL, wetR] = reverb(sendL, sendR)

  const out = [new Float32Array(n), new Float32Array(n)]
  const dry = [[fx.l, music.l, wetL], [fx.r, music.r, wetR]]
  let peak = 0
  for (let ch = 0; ch < 2; ch++) {
    const [f, m, wet] = dry[ch]
    let dc = 0
    for (let i = 0; i < n; i++) {
      const x = f[i] + m[i] * duck[i] + wet[i] * 0.9
      // One-pole high-pass at 22 Hz, then a soft clip so the hits round off instead of clipping.
      dc += (x - dc) * (TAU * 22 / SR)
      const y = Math.tanh((x - dc) * 1.1)
      // Fade the tail out over the last moments so the file ends on silence.
      out[ch][i] = y * Math.min(1, (n - i) / (0.45 * SR))
      peak = Math.max(peak, Math.abs(out[ch][i]))
    }
  }
  const gain = 10 ** (-1 / 20) / peak
  for (const channel of out) {
    for (let i = 0; i < n; i++)
      channel[i] *= gain
  }
  return out
}

/** Renders the soundtrack (or the `from`..`to` stretch of it) to a 16-bit stereo WAV. */
export async function writeSoundtrack(file, { from = 0, to = DURATION } = {}) {
  const [l, r] = master(score())
  const first = Math.round(from * SR)
  const count = Math.round(to * SR) - first
  const data = Buffer.alloc(count * 4)
  for (let i = 0; i < count; i++) {
    data.writeInt16LE(Math.round(l[first + i] * 32767), i * 4)
    data.writeInt16LE(Math.round(r[first + i] * 32767), i * 4 + 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(2, 22)
  header.writeUInt32LE(SR, 24)
  header.writeUInt32LE(SR * 4, 28)
  header.writeUInt16LE(4, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  await writeFile(file, Buffer.concat([header, data]))
}
