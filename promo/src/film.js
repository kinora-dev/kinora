// The film. One function of time, `seek(t)`, places every element on stage.
// Nothing remembers the previous frame, so frames can be rendered in any
// order, in parallel, and at sub-frame instants (that is how the motion blur
// is made: several instants per frame, averaged).
//
// The story is one orange dot that never cuts: it is the record light, then
// the pen that writes the headline, the head that records each run, the "now"
// marker on the dashboard, the playhead in the trace, and finally the logo.
import { bezier, clamp, ease, lerp, lerpLog, prog, spring, track } from './ease.js'
import { STAGE_H, STAGE_W } from './plane.js'
import { advanceBirth, ADVANCES, b, CUE, stripBirth } from './timing.js'
import { createTrace, ERROR_SEG, headPoint, camAt as traceCamAt } from './trace.js'
import { createWall, FAIL, slot, STRIP_ZOOM, camAt as wallCamAt } from './wall.js'

const CX = STAGE_W / 2
const CY = STAGE_H / 2
const WHIP = ease.whip
const WRITE = bezier(0.3, 0, 0.2, 1)

const [pb0, pb1] = CUE.pullBack
const [pi0, pi1] = CUE.pushIn
const [dv0, dv1] = CUE.dive
const [e0] = CUE.emerge
const [c0] = CUE.collapse

// ---- Type -----------------------------------------------------------------

const TYPE_SIZE = 66
const COLUMN_X = 112
// Line tops for a three, one, and two line block, centred on the frame.
const COL3 = [CY - 105, CY - 33, CY + 39]
const COL1 = CY - 33
const COL2 = [CY - 69, CY + 3]
// The headline is written large and centred, then steps aside into the column.
const BIG = 1.36
const BIG_FEATHER = 54

function makeLine(root, content, id) {
  const el = document.createElement('div')
  el.className = 'line'
  if (id)
    el.id = id
  el.textContent = content
  root.append(el)
  return { el }
}

function measure(line) {
  const size = Number.parseFloat(getComputedStyle(line.el).fontSize)
  line.padX = 0.14 * size
  line.padY = 0.28 * size
  line.size = size
  line.boxW = line.el.offsetWidth
  line.textW = line.boxW - 2 * line.padX
}

/** Where the ink of a line starts and ends, relative to its text box, ignoring tracking. */
function ink(line) {
  const style = getComputedStyle(line.el)
  const ctx = document.createElement('canvas').getContext('2d')
  ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`
  const content = style.textTransform === 'uppercase' ? line.el.textContent.toUpperCase() : line.el.textContent
  const m = ctx.measureText(content)
  return { left: -m.actualBoundingBoxLeft, right: m.actualBoundingBoxRight }
}

/** Put a line's text box at (x, y), written to `w` and erased to `o` (both 0..1). */
function place(line, x, y, scale, w, o, mute = 0) {
  const hidden = w <= 0 || o >= 1
  line.el.style.display = hidden ? 'none' : ''
  if (hidden)
    return
  line.el.style.transform = `translate(${x - line.padX * scale}px,${y - line.padY * scale}px) scale(${scale})`
  line.el.style.setProperty('--w', w)
  line.el.style.setProperty('--o', o)
  if (mute != null)
    line.el.style.color = `color-mix(in oklch, var(--foreground), var(--muted-foreground) ${mute * 100}%)`
}

function erased(t, [from, to], delay = 0) {
  return ease.inOutQuad(prog(t, from + delay, to + delay))
}

// ---- The dot --------------------------------------------------------------

const DOT_BIG = 200
const DOT_PEN = 40
const LOGO_Y = 478
const LOGO_DOT = 82
// Measured from the dot to the ink of the "k", not to its text box.
const LOGO_GAP = 76

// How big the dot is in wall pixels while it rides the hero strip.
const penOnWall = track([[pb0, DOT_PEN / STRIP_ZOOM], [pb1, 19, WHIP], [pi0, 19], [pi1, 12.5, WHIP]])

// The recording head, in strip slots. It accelerates out of the carriage
// return, crosses one bar per 32nd note, then overshoots the last one a touch.
function headU(t) {
  const rate = 1 / CUE.stripEvery
  const start = CUE.carriage[1]
  const last = stripBirth(19)
  if (t <= start)
    return -1
  if (t < CUE.stripFirst)
    return -1 + ((t - start) / (CUE.stripFirst - start)) ** 2
  if (t < last)
    return (t - CUE.stripFirst) * rate
  const s = t - last
  return 19 + rate / 26 * Math.sin(26 * s) * Math.exp(-13 * s)
}

const RINGS = [
  { at: CUE.pop, dur: 0.95, to: 3.6, alpha: 0.55 },
  { at: CUE.pop + 0.14, dur: 1.05, to: 2.5, alpha: 0.3 },
  { at: CUE.pulse, dur: 0.75, to: 1.75, alpha: 0.5 },
  { at: stripBirth(19), dur: 0.55, to: 3.4, alpha: 0.5 },
  { at: CUE.fail, dur: 0.6, to: 6, alpha: 0.8, color: 'var(--fail)' },
  { at: CUE.lock, dur: 0.6, to: 5, alpha: 0.7, color: 'var(--fail)' },
  { at: CUE.logo, dur: 1.0, to: 3.4, alpha: 0.55 },
  { at: CUE.logo + 0.12, dur: 1.1, to: 2.3, alpha: 0.3 },
  { at: CUE.lastPulse, dur: 0.85, to: 1.8, alpha: 0.45 },
]

// ---- Film -----------------------------------------------------------------

export async function createFilm(stage) {
  await Promise.all([
    document.fonts.load(`600 ${TYPE_SIZE}px "Hanken Grotesk Variable"`),
    document.fonts.load('400 13px "Hanken Grotesk Variable"'),
    document.fonts.load('600 164px "JetBrains Mono Variable"'),
    document.fonts.load('400 12px "JetBrains Mono Variable"'),
  ])
  await document.fonts.ready

  const $ = id => stage.querySelector(`#${id}`)
  const wall = createWall($('wall'))
  const trace = createTrace($('trace'))
  const lens = $('lens')
  const grid = $('grid')
  const glow = $('glow')
  const lume = $('lume')
  const dot = $('dot')
  const beam = $('beam')
  const portal = $('portal')
  const scrim = $('scrim')
  const rings = RINGS.map(() => {
    const ring = document.createElement('div')
    ring.className = 'ring'
    $('rings').append(ring)
    return ring
  })

  const type = $('type')
  const l1 = makeLine(type, 'Your Playwright tests,')
  const l2 = makeLine(type, 'across projects')
  const l3 = makeLine(type, 'and over time.')
  const flaky = makeLine(type, 'Surface flaky tests.')
  const t1 = makeLine(type, 'Open the full')
  const t2 = makeLine(type, 'trace inline.')
  const wordmark = makeLine(type, 'kinora', 'wordmark')
  const tagline = makeLine(type, 'Playwright test intelligence', 'tagline')
  const url = makeLine(type, 'kinora.dev', 'url')
  l1.el.style.setProperty('--feather', `${BIG_FEATHER}px`)
  for (const line of [l1, l2, l3, flaky, t1, t2, wordmark, tagline, url])
    measure(line)

  const l1BigX = CX - l1.textW * BIG / 2
  // The lockup is set by ink, not by text boxes: dot, gap, then the name. The
  // tagline is tracked out until it sits flush under it, edge to edge.
  const nameInk = ink(wordmark)
  const nameTracking = Number.parseFloat(getComputedStyle(wordmark.el).letterSpacing) * (wordmark.el.textContent.length - 1)
  const lockupW = LOGO_DOT + LOGO_GAP + nameInk.right + nameTracking - nameInk.left
  const lockupX = CX - lockupW / 2
  const logoDotX = lockupX + LOGO_DOT / 2
  const tagInk = ink(tagline)
  tagline.el.style.letterSpacing = `${(lockupW - (tagInk.right - tagInk.left)) / (tagline.el.textContent.length - 1)}px`

  // Where the dot sits while it writes the headline: just ahead of the ink.
  function penOnLine(w) {
    return { x: l1BigX - l1.padX * BIG + w * (l1.boxW + BIG_FEATHER) * BIG + DOT_PEN / 2, y: CY }
  }

  function onStrip(t) {
    const cam = wallCamAt(t)
    const size = penOnWall(t)
    const at = slot(headU(t))
    const p = wall.plane.project(at.x, at.top - size / 2 - 4, cam)
    return { x: p.x, y: p.y, size: size * p.scale, base: wall.plane.project(at.x, at.bottom + 2, cam) }
  }

  function onTrace(t) {
    const cam = traceCamAt(t)
    const at = headPoint(t)
    const p = trace.plane.project(at.x, at.top - 13, cam)
    return { x: p.x, y: p.y, size: 15 * p.scale, base: trace.plane.project(at.x, at.bottom + 4, cam) }
  }

  // The dot's whole journey. Pure, so its velocity can be measured for stretch.
  function dotAt(t) {
    const [toLine0, toLine1] = CUE.toLine
    const [ret0, ret1] = CUE.carriage
    if (t < toLine0) {
      // A breath of anticipation to the right before it darts left.
      const lean = 18 * ease.inOutSine(prog(t, toLine0 - 0.16, toLine0))
      // Two frames early, so even the very first frame has the dot in it.
      return { x: CX + lean, y: CY, size: DOT_BIG * spring(prog(t, CUE.pop - 0.033, CUE.pop + 0.667), 0.5) }
    }
    if (t < toLine1) {
      const p = WHIP(prog(t, toLine0, toLine1))
      return { x: lerp(CX + 18, penOnLine(0).x, p), y: CY, size: lerpLog(DOT_BIG, DOT_PEN, p) }
    }
    if (t < ret0)
      return { ...penOnLine(ease.inOutQuad(prog(t, ...CUE.writeLine1))), size: DOT_PEN }
    if (t < ret1) {
      const p = ease.inOutCubic(prog(t, ret0, ret1))
      const to = onStrip(ret1)
      return { x: lerp(penOnLine(1).x, to.x, p), y: lerp(CY, to.y, p), size: DOT_PEN }
    }
    if (t < dv1) {
      const at = onStrip(t)
      return { ...at, beam: prog(t, ret1, ret1 + 0.14) * (1 - prog(t, dv0, lerp(dv0, dv1, 0.5))) }
    }
    if (t < CUE.headIn - 0.15)
      return { x: CX, y: -200, size: 0 }
    if (t < c0) {
      // Drops back in from where it left the frame and lands on the timeline.
      const at = onTrace(t)
      const land = spring(prog(t, CUE.headIn - 0.15, CUE.headIn + 0.4), 0.55)
      return { ...at, y: at.y - (1 - land) * 320, beam: prog(t, CUE.headIn + 0.02, CUE.headIn + 0.2) }
    }
    if (t < CUE.logo) {
      const from = onTrace(c0)
      const p = bezier(0.5, 0, 0.1, 1)(prog(t, c0, CUE.logo))
      return {
        x: lerp(from.x, CX, p),
        y: lerp(from.y, LOGO_Y, p) - Math.sin(Math.PI * p) * 110,
        size: lerpLog(from.size, LOGO_DOT, p),
        base: from.base,
        beam: 1 - prog(t, c0, c0 + 0.12),
      }
    }
    // The lockup opens from the centre: the dot slides left as the name is written.
    const open = ease.outQuart(prog(t, ...CUE.writeLogo))
    return { x: lerp(CX, logoDotX, open), y: LOGO_Y, size: LOGO_DOT }
  }

  // How bright the dot's light is, in the air around it and on the UI under it.
  const glowLevel = track([
    [0, 0],
    [0.3, 0.24, ease.outCubic],
    [CUE.toLine[1], 0.15],
    [pb0, 0.15],
    [pb1, 0.13],
    [dv0, 0.13],
    [dv1, 0],
    [CUE.headIn, 0],
    [CUE.headIn + 0.5, 0.1],
    [c0, 0.1],
    [CUE.logo, 0.3, ease.inCubic],
    [CUE.logo + 0.8, 0.2, ease.outCubic],
  ])
  const lumeLevel = track([
    [CUE.carriage[1], 0],
    [CUE.stripFirst, 0.4],
    [dv0, 0.4],
    [lerp(dv0, dv1, 0.5), 0],
    [CUE.headIn, 0],
    [CUE.headIn + 0.4, 0.4],
    [c0, 0.4],
    [c0 + 0.3, 0],
  ])

  function updateDot(t) {
    const at = dotAt(t)
    const before = dotAt(t - 1 / 240)
    const vx = (at.x - before.x) * 240
    const vy = (at.y - before.y) * 240
    // Stretch along the direction of travel, less the bigger it is; real blur does the rest.
    const stretch = Math.sqrt(1 + Math.min(0.4, Math.hypot(vx, vy) / 7000) * clamp(50 / Math.max(at.size, 1)))
    // A stamp each time it records a run, and a punch when it lands as the logo.
    let size = at.size
    for (let k = 0; k < ADVANCES; k++) {
      const s = t - advanceBirth(k)
      if (s >= 0 && s < 0.11)
        size *= 1 + 0.2 * Math.sin(Math.PI * s / 0.11)
    }
    const landing = prog(t, CUE.logo - 0.04, CUE.logo + 0.34)
    size *= 1 + 0.24 * Math.sin(Math.PI * landing) * (1 - landing)
    size *= 1 + 0.5 * Math.sin(Math.PI * prog(t, CUE.fail - 0.02, CUE.fail + 0.22)) * (1 - prog(t, CUE.fail - 0.02, CUE.fail + 0.22))

    // The brand's rec-pulse: the light dips, a ring leaves.
    const dip = Math.sin(Math.PI * prog(t, CUE.pulse, CUE.pulse + 0.6)) + Math.sin(Math.PI * prog(t, CUE.lastPulse, CUE.lastPulse + 0.7))
    const shown = at.size > 0.5
    dot.style.display = shown ? '' : 'none'
    dot.style.opacity = 1 - 0.42 * dip
    dot.style.transform = `translate(${at.x}px,${at.y}px) rotate(${Math.atan2(vy, vx)}rad) scale(${size / 100 * stretch},${size / 100 / stretch})`

    const lit = (at.beam ?? 0) > 0.001 && at.base
    beam.style.display = lit ? '' : 'none'
    if (lit) {
      const dx = at.base.x - at.x
      const dy = at.base.y - at.y
      beam.style.height = `${Math.hypot(dx, dy) * at.beam}px`
      beam.style.width = `${Math.max(1.5, size * 0.07)}px`
      beam.style.transform = `translate(${at.x}px,${at.y}px) rotate(${-Math.atan2(dx, dy)}rad)`
    }

    RINGS.forEach((ring, i) => {
      const p = prog(t, ring.at, ring.at + ring.dur)
      const el = rings[i]
      const live = shown && p > 0 && p < 1
      el.style.display = live ? '' : 'none'
      if (!live)
        return
      const d = at.size * lerp(1, ring.to, ease.outCubic(p))
      el.style.transform = `translate(${at.x}px,${at.y}px) scale(${d / 100})`
      el.style.opacity = ring.alpha * (1 - p) ** 1.6
      el.style.borderWidth = `${Math.max(1.5, 2.5 * (1 - p)) * 100 / d}px`
      el.style.borderColor = ring.color ?? ''
    })

    // The dot lights the room: the glow follows it and swells with it.
    const level = glowLevel(t) * (shown ? 1 : 0) * (1 - 0.3 * dip)
    glow.style.display = level > 0.002 ? '' : 'none'
    glow.style.opacity = level
    glow.style.transform = `translate(${at.x}px,${at.y}px) scale(${0.42 + Math.min(1.2, size / 170)})`
    // While it hovers over the UI, the same light falls on the cards beneath it.
    const cast = lumeLevel(t) * (shown ? 1 : 0) * (1 - 0.3 * dip)
    lume.style.display = cast > 0.002 ? '' : 'none'
    lume.style.opacity = cast
    lume.style.transform = `translate(${at.x}px,${at.y}px) scale(${clamp(size / 55, 0.3, 1.2)})`
  }

  // The red bar becomes the screen, then becomes the failing action in the trace.
  function updatePortal(t) {
    let rect
    let radius
    let level
    if (t >= dv0 && t < dv1) {
      const cam = wallCamAt(t)
      rect = wall.plane.projectRect(FAIL, cam)
      radius = 2 * cam.zoom
      level = prog(t, dv0, lerp(dv0, dv1, 0.35))
    }
    else if (t >= dv1 && t < e0 + 0.6) {
      const cam = traceCamAt(t)
      rect = trace.plane.projectRect(ERROR_SEG, cam)
      radius = 6 * cam.zoom
      level = prog(Math.log(cam.zoom), Math.log(5.5), Math.log(7))
    }
    const shown = rect && level > 0
    portal.style.display = shown ? '' : 'none'
    if (!shown)
      return
    // Keep the element a sane size once its corners are far off screen.
    const m = radius + 100
    const x0 = Math.max(rect.x, -m)
    const y0 = Math.max(rect.y, -m)
    const x1 = Math.min(rect.x + rect.w, STAGE_W + m)
    const y1 = Math.min(rect.y + rect.h, STAGE_H + m)
    portal.style.transform = `translate(${x0}px,${y0}px)`
    portal.style.width = `${x1 - x0}px`
    portal.style.height = `${y1 - y0}px`
    portal.style.borderRadius = `${Math.min(radius, (y1 - y0) / 2, (x1 - x0) / 2)}px`
    portal.style.opacity = level
  }

  function updateType(t) {
    // "Your Playwright tests," is written by the dot at the centre of the frame,
    // feeds up like paper while the dot returns, then joins the column.
    const feed = ease.outExpo(prog(t, CUE.carriage[0], CUE.carriage[0] + 0.55))
    // It leaves first, so the card can grow where it was.
    const move = WHIP(prog(t, pb0 - 0.05, pb0 + 0.5))
    const top = lerp(lerp(CY, 352, feed) - l1.size * BIG / 2, COL3[0], move)
    place(l1, lerp(l1BigX, COLUMN_X, move), top, lerp(BIG, 1, move), ease.inOutQuad(prog(t, ...CUE.writeLine1)), erased(t, CUE.eraseHeadline, -0.08))

    // Each new line arrives white; the older ones settle to the brand's muted grey.
    const w2 = prog(t, ...CUE.writeLine2)
    place(l2, COLUMN_X - 16 * (1 - ease.outCubic(w2)), COL3[1], 1, WRITE(w2), erased(t, CUE.eraseHeadline, -0.03), prog(t, CUE.writeLine3[0], CUE.writeLine3[0] + 0.45))
    const w3 = prog(t, ...CUE.writeLine3)
    place(l3, COLUMN_X - 16 * (1 - ease.outCubic(w3)), COL3[2], 1, WRITE(w3), erased(t, CUE.eraseHeadline, 0.02), prog(t, b(14), b(14.9)))

    const wf = prog(t, ...CUE.writeFlaky)
    place(flaky, COLUMN_X - 16 * (1 - ease.outCubic(wf)), COL1, 1, WRITE(wf), erased(t, CUE.eraseFlaky))

    const [tr0, tr1] = CUE.writeTrace
    const wt1 = prog(t, tr0, lerp(tr0, tr1, 0.7))
    const wt2 = prog(t, lerp(tr0, tr1, 0.3), tr1)
    place(t1, COLUMN_X - 16 * (1 - ease.outCubic(wt1)), COL2[0], 1, WRITE(wt1), erased(t, CUE.eraseTrace, -0.04))
    place(t2, COLUMN_X - 16 * (1 - ease.outCubic(wt2)), COL2[1], 1, WRITE(wt2), erased(t, CUE.eraseTrace, 0.03))

    // The lockup: the name is written out of the dot, then the two quiet lines.
    const open = ease.outQuart(prog(t, ...CUE.writeLogo))
    const nameX = lerp(CX, logoDotX, open) + LOGO_DOT / 2 + LOGO_GAP - nameInk.left
    // Raised a hair so the dot sits on the middle of the x-height, where the eye wants it.
    place(wordmark, nameX, LOGO_Y - wordmark.size * 0.575, 1, t < CUE.logo ? 0 : Math.max(0.001, open), 0, null)
    place(tagline, lockupX - tagInk.left, LOGO_Y + 106, 1, WRITE(prog(t, ...CUE.tagline)), 0, null)
    place(url, CX - url.textW / 2, LOGO_Y + 106 + 76, 1, WRITE(prog(t, ...CUE.url)), 0, null)
  }

  // The whole picture creeps in on the opening and on the end card, and
  // takes a small kick on the three hardest hits.
  function updateLens(t) {
    const kick = (at, amount) => (t < at ? 0 : amount * Math.exp(-(t - at) / 0.11))
    const scale = 1
      + 0.022 * ease.inOutSine(prog(t, 0, b(7))) * (1 - WHIP(prog(t, pb0, pb0 + 0.5)))
      + 0.028 * ease.outCubic(prog(t, CUE.logo, CUE.logo + 1.9))
      + kick(CUE.fail, 0.012) + kick(CUE.lock, 0.008) + kick(CUE.logo, 0.016)
    lens.style.transform = `scale(${scale})`
  }

  function updateAtmosphere(t) {
    // Black until the camera pulls back and the room appears; the grid rushes
    // past on the dive and falls back into place with the trace.
    const rush = t < dv1 ? ease.inCubic(prog(t, dv0, dv1)) : 1 - ease.outExpo(prog(t, e0, e0 + 0.7))
    grid.style.opacity = ease.inOutCubic(prog(t, pb0, pb1)) * (1 - rush)
    grid.style.transform = `scale(${lerp(1.18, 1, WHIP(prog(t, pb0, pb1))) * (1 + 0.9 * rush)})`
    // While the camera is close on the hero card, the caption needs a quiet wall behind it.
    scrim.style.opacity = WHIP(prog(t, pi0, pi0 + 0.9)) * (1 - prog(t, dv0, lerp(dv0, dv1, 0.5)))
  }

  function seek(t, tf = t) {
    wall.update(t, tf)
    trace.update(t)
    updatePortal(t)
    updateType(t)
    updateDot(t)
    updateAtmosphere(t)
    updateLens(t)
  }

  return { seek }
}
