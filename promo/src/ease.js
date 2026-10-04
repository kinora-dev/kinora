// Small math kit for a film that is a pure function of time: no tweens, no
// state carried between frames, so any frame can be rendered in any order.

export function clamp(x, lo = 0, hi = 1) {
  return Math.min(hi, Math.max(lo, x))
}

export function lerp(a, z, p) {
  return a + (z - a) * p
}

/** Progress of `t` through [from, to], clamped to 0..1. */
export function prog(t, from, to) {
  return clamp((t - from) / (to - from))
}

/** Zoom-style interpolation: equal steps feel equal when scale is multiplied. */
export function lerpLog(a, z, p) {
  return Math.exp(lerp(Math.log(a), Math.log(z), p))
}

/** Deterministic noise in 0..1 (stands in for Math.random). */
export function hash(n) {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return s - Math.floor(s)
}

/** CSS-style cubic-bezier easing, solved with a few Newton steps. */
export function bezier(x1, y1, x2, y2) {
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  return (p) => {
    if (p <= 0 || p >= 1)
      return clamp(p)
    let u = p
    for (let i = 0; i < 6; i++) {
      const x = ((ax * u + bx) * u + cx) * u - p
      const dx = (3 * ax * u + 2 * bx) * u + cx
      if (Math.abs(dx) < 1e-6)
        break
      u -= x / dx
    }
    return ((ay * u + by) * u + cy) * u
  }
}

export const ease = {
  linear: p => p,
  inQuad: p => p * p,
  outQuad: p => 1 - (1 - p) ** 2,
  inOutQuad: p => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2),
  inCubic: p => p ** 3,
  outCubic: p => 1 - (1 - p) ** 3,
  inOutCubic: p => (p < 0.5 ? 4 * p ** 3 : 1 - (-2 * p + 2) ** 3 / 2),
  inQuart: p => p ** 4,
  outQuart: p => 1 - (1 - p) ** 4,
  outQuint: p => 1 - (1 - p) ** 5,
  // Normalized so they land exactly on 0 and 1 (the textbook versions miss by 0.1%).
  inExpo: p => (2 ** (10 * p) - 1) / 1023,
  outExpo: p => (1 - 2 ** (-10 * p)) / (1 - 2 ** -10),
  inOutSine: p => -(Math.cos(Math.PI * p) - 1) / 2,
  // The house curve for camera moves: a short wind-up, whips, lands soft.
  whip: bezier(0.3, 0, 0, 1),
  // Snappy settle for UI elements.
  snap: bezier(0.2, 0.9, 0.2, 1),
}

/**
 * Step response of an underdamped spring, normalized so it has settled at p = 1.
 * `zeta` is the damping ratio: 0.45 is bouncy, 0.7 barely overshoots.
 */
export function spring(p, zeta = 0.55) {
  if (p <= 0)
    return 0
  if (p >= 1)
    return 1
  const w = 6.9 / zeta
  const wd = w * Math.sqrt(1 - zeta * zeta)
  return 1 - Math.exp(-6.9 * p) * (Math.cos(wd * p) + (zeta * w / wd) * Math.sin(wd * p))
}

/**
 * Keyframe track: `[[time, value, easeInto?], ...]` returns `t => value`.
 * Holds the first value before the first key and the last one after.
 */
export function track(keys, mix = lerp) {
  return (t) => {
    if (t <= keys[0][0])
      return keys[0][1]
    for (let i = 1; i < keys.length; i++) {
      const [t1, v1, into = ease.inOutCubic] = keys[i]
      if (t < t1) {
        const [t0, v0] = keys[i - 1]
        return mix(v0, v1, into((t - t0) / (t1 - t0)))
      }
    }
    return keys.at(-1)[1]
  }
}

/** A value that kicks to 1 at `at` and decays back to 0 over `dur`. */
export function pulse(t, at, dur, shape = ease.outCubic) {
  if (t < at || t > at + dur)
    return 0
  return 1 - shape((t - at) / dur)
}
