// The dashboard wall: the Test runs overview page (stats row + six project
// cards), built to the real components' measurements and filmed by one camera.
import { arrived, formatPct, HERO, HERO_FAIL, HERO_FLAKY, passRate, PROJECTS, SLOTS } from './data.js'
import { ease, hash, lerp, lerpLog, prog, pulse, spring, track } from './ease.js'
import { Plane } from './plane.js'
import { b, CUE, stripBirth } from './timing.js'

const CARD_W = 400
const CARD_H = 215
const GAP = 20
const CARDS_TOP = 116
const STRIP_H = 38
// Whole-pixel bars (the browser snaps boxes to pixels, and the dive zooms in
// far enough to see half a pixel); the gap takes up the remainder.
const BAR_W = 15
const PITCH = BAR_W + (360 - SLOTS * BAR_W) / (SLOTS - 1)
const SPARK = { w: 220, h: 40, pad: 3 }
const LABEL = { pass: 'Passing', flaky: 'Flaky', fail: 'Failing' }

const HERO_P = PROJECTS[HERO]
const HERO_X = HERO_P.col * (CARD_W + GAP)
const HERO_Y = CARDS_TOP + HERO_P.row * (CARD_H + GAP)
// The hero strip, in wall coordinates.
const STRIP = { x: HERO_X + 20, y: HERO_Y + 124 }
const FAIL_H = barHeight(HERO_P.runs[HERO_FAIL])
/** The failing bar the camera dives into. */
export const FAIL = { x: STRIP.x + (SLOTS - 1) * PITCH, y: STRIP.y + STRIP_H - FAIL_H, w: BAR_W, h: FAIL_H }

const [pb0, pb1] = CUE.pullBack
const [pi0, pi1] = CUE.pushIn
const [, db1] = CUE.diveBack
const [dv0, dv1] = CUE.dive
const WHIP = ease.whip

/** How far the camera is zoomed in while the dot records the first strip. */
export const STRIP_ZOOM = 3.55
// While runs keep arriving the camera creeps in and orbits, so the wall grows
// as time speeds up. The keyed framings below are set net of this drift.
const DRIFT = { zoom: 0.12, sx: 60, rx: -1, ry: 6 }

// Three framings and the dive. Bar 2 is flat on one strip, bar 3 pulls back to
// the tilted wall (the og-image composition), bar 5 pushes in on the hero card.
const BASE = {
  fx: track([[dv0, 620], [dv1, FAIL.x + FAIL.w / 2, ease.outCubic]]),
  fy: track([[pb0, STRIP.y + STRIP_H / 2], [pb1, 290, WHIP], [pi0, 290], [pi1, HERO_Y + CARD_H / 2, WHIP], [dv0, HERO_Y + CARD_H / 2], [dv1, FAIL.y + FAIL.h / 2, ease.outCubic]]),
  sx: track([[pb0, 960], [pb1, 1395, WHIP], [pi0, 1395], [pi1, 1250 - DRIFT.sx, WHIP], [dv0, 1250 - DRIFT.sx], [dv1, 960, ease.outCubic]]),
  // In bar 2 the strip's top sits 34px under the frame's centre line, where the dot writes.
  sy: track([[pb0, 574 + STRIP_H / 2 * STRIP_ZOOM], [pb1, 548, WHIP], [pi0, 548], [pi1, 532, WHIP], [dv0, 532], [dv1, 540, ease.outCubic]]),
  zoom: track([
    [b(7), STRIP_ZOOM],
    [pb0, STRIP_ZOOM * 1.035, ease.inOutSine],
    [pb1, 1.03, WHIP],
    [pi0, 1.03],
    [pi1, 2.4 / (1 + DRIFT.zoom), WHIP],
    [CUE.diveBack[0], 2.46 / (1 + DRIFT.zoom), ease.inOutSine],
    [db1, 2.2 / (1 + DRIFT.zoom), ease.outCubic],
    [dv1, 150, ease.inCubic],
  ], lerpLog),
  rx: track([[pb0, 0], [pb1, 7, WHIP], [pi0, 7], [pi1, 3 - DRIFT.rx, WHIP], [dv0, 3 - DRIFT.rx], [lerp(dv0, dv1, 0.6), 0]]),
  ry: track([[pb0, 0], [pb1, -17, WHIP], [pi0, -17], [pi1, -7 - DRIFT.ry, WHIP], [dv0, -7 - DRIFT.ry], [lerp(dv0, dv1, 0.6), 0]]),
  rz: track([[pb0, 0], [pb1, -2, WHIP], [pi0, -2], [pi1, -1, WHIP], [dv0, -1], [lerp(dv0, dv1, 0.6), 0]]),
}

function drift(t) {
  return ease.inOutSine(prog(t, pb0 + 0.6, pi1)) * (1 - prog(t, dv0, lerp(dv0, dv1, 0.6)))
}

// The failing run lands hard enough to knock the camera.
function shake(t) {
  const s = t - CUE.fail
  if (s < 0 || s > 0.7)
    return [0, 0]
  const a = Math.exp(-8 * s)
  return [10 * a * Math.sin(58 * s), 7 * a * Math.sin(41 * s)]
}

export function camAt(t) {
  const d = drift(t)
  const [kx, ky] = shake(t)
  return {
    fx: BASE.fx(t),
    fy: BASE.fy(t),
    sx: BASE.sx(t) + DRIFT.sx * d + kx,
    sy: BASE.sy(t) + ky,
    zoom: BASE.zoom(t) * (1 + DRIFT.zoom * d),
    rx: BASE.rx(t) + DRIFT.rx * d,
    ry: BASE.ry(t) + DRIFT.ry * d,
    rz: BASE.rz(t),
  }
}

/** Wall coordinates of slot `u` on the hero strip (fractional while the dot travels). */
export function slot(u) {
  return { x: STRIP.x + u * PITCH + BAR_W / 2, top: STRIP.y, bottom: STRIP.y + STRIP_H }
}

// RunStrip draws a run as tall as its pass rate, with a floor so it never vanishes.
function barHeight(run) {
  return Math.round(STRIP_H * Math.max(0.12, run.pct))
}

// Each arrival pushes the strip one slot left just before the new bar lands.
// The push takes most of the gap since the previous run, capped at a 16th note.
function tape(project, t) {
  let off = 0
  project.arrivals.forEach((at, k) => {
    const lead = 0.6 * Math.min(b(1 / 4), k ? at - project.arrivals[k - 1] : Infinity)
    off += ease.inOutCubic(prog(t, at - lead, at - lead * 0.1))
  })
  return off
}

function statsHtml() {
  const stat = (key, label) => `<div class="stat"><span class="label">${label}</span><b data-stat="${key}"></b></div>`
  const blocks = [
    stat('projects', 'Projects'),
    stat('rate', 'Global pass rate'),
    stat('tests', 'Tests / latest'),
    stat('runs', 'Total runs'),
    stat('failing', 'Failing now'),
  ]
  return `<div class="stats">${blocks.join('<span class="sep"></span>')}</div>`
}

function cardHtml(p) {
  const left = p.col * (CARD_W + GAP)
  const top = CARDS_TOP + p.row * (CARD_H + GAP)
  return `<div class="card" data-card="${p.index}" style="left:${left}px;top:${top}px">
    <div class="card-bg"></div>
    <div class="card-chrome">
      <div class="card-head"><span class="card-title">${p.name}</span><span class="badge"><i></i><span></span></span></div>
      <div class="card-rate">
        <div class="col"><span class="label">Pass rate <em>· last ${SLOTS}</em></span><span class="rate"></span></div>
        <div class="spark"><svg width="${SPARK.w}" height="${SPARK.h}" viewBox="0 0 ${SPARK.w} ${SPARK.h}">
          <defs><linearGradient id="spark-${p.index}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stop-color="currentColor" stop-opacity="0.18" /><stop offset="100%" stop-color="currentColor" stop-opacity="0" />
          </linearGradient></defs>
          <polygon fill="url(#spark-${p.index})" />
          <polyline fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" pathLength="1" stroke-dasharray="1" />
        </svg></div>
      </div>
      <div class="card-foot"><span></span><span>${p.tests} tests · ${p.took}</span><span></span></div>
    </div>
    <div class="strip"></div>
  </div>`
}

// Corner brackets that close on a flaky bar.
function reticleHtml() {
  const w = BAR_W + 8
  const h = STRIP_H + 10
  const l = 5
  const d = `M0,${l} V0 H${l} M${w - l},0 H${w} V${l} M${w},${h - l} V${h} H${w - l} M${l},${h} H0 V${h - l}`
  return `<div class="reticle" style="width:${w}px"><svg width="${w}" height="${h}"><path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" /></svg></div>`
}

function text(node, value) {
  if (node.textContent !== value)
    node.textContent = value
}

// The health badge follows the latest run, so it only changes on arrivals.
// When runs come faster than a badge can flip, states too brief to read are skipped.
function badgeChanges(project) {
  const raw = [{ at: -1, status: project.runs[SLOTS - 1].status }]
  project.arrivals.forEach((at, k) => {
    const status = project.runs[SLOTS + k].status
    if (status !== raw.at(-1).status)
      raw.push({ at, status })
  })
  const changes = [raw[0]]
  for (let i = 1; i < raw.length; i++) {
    const brief = raw[i + 1] && raw[i + 1].at - raw[i].at < 0.2
    if (!brief && raw[i].status !== changes.at(-1).status)
      changes.push(raw[i])
  }
  return changes
}

export function createWall(el) {
  el.innerHTML = statsHtml() + PROJECTS.map(cardHtml).join('')
  const plane = new Plane(el)
  const statsEl = el.querySelector('.stats')
  const stat = Object.fromEntries(Array.from(el.querySelectorAll('[data-stat]'), n => [n.dataset.stat, n]))
  const totalTests = PROJECTS.reduce((sum, p) => sum + p.tests, 0)

  const cards = PROJECTS.map((project) => {
    const root = el.querySelector(`[data-card="${project.index}"]`)
    const strip = root.querySelector('.strip')
    const isHero = project.index === HERO
    const dist = Math.hypot(project.col - HERO_P.col, project.row - HERO_P.row)
    // Neighbours cascade in once the camera has nearly landed, nearest first.
    const revealAt = pb0 + (isHero ? 0 : 0.5 + dist * 0.08)
    const bars = project.runs.map((run, j) => {
      const bar = document.createElement('div')
      bar.className = 'bar'
      bar.style.width = `${BAR_W}px`
      bar.style.height = `${barHeight(run)}px`
      bar.style.display = 'none'
      strip.append(bar)
      // The hero's first strip is recorded by the dot, the others fill in as a wave.
      const birth = j >= SLOTS ? project.arrivals[j - SLOTS] : isHero ? stripBirth(j) : revealAt + 0.14 + j * 0.008
      return { el: bar, run, birth, shown: false }
    })
    const foot = root.querySelectorAll('.card-foot span')
    return {
      project,
      root,
      isHero,
      revealAt,
      bars,
      bg: root.querySelector('.card-bg'),
      chrome: root.querySelector('.card-chrome'),
      rate: root.querySelector('.rate'),
      badge: root.querySelector('.badge'),
      badgeText: root.querySelector('.badge span'),
      line: root.querySelector('polyline'),
      area: root.querySelector('polygon'),
      runsLabel: foot[0],
      agoLabel: foot[2],
      changes: badgeChanges(project),
    }
  })

  const hero = cards[HERO]
  const heroStrip = hero.root.querySelector('.strip')
  heroStrip.insertAdjacentHTML('beforeend', HERO_FLAKY.map(reticleHtml).join(''))
  heroStrip.insertAdjacentHTML('beforeend', '<div class="tip"><b>Jun 14</b><span>100.0% pass</span><span>0 fail / 2 flaky</span></div>')
  const reticles = [...heroStrip.querySelectorAll('.reticle')]
  const tip = heroStrip.querySelector('.tip')
  const lockAt = new Map(HERO_FLAKY.map((j, i) => [j, CUE.locks[i]]))

  function updateBadge(card, t) {
    const { changes } = card
    let i = 0
    while (i + 1 < changes.length && t >= changes[i + 1].at)
      i++
    // Flip like a split-flap: the old state tips away, the new one drops in.
    const since = t - changes[i].at
    const dur = 0.26
    const half = dur * 0.4
    const flipping = i > 0 && since < dur
    const status = flipping && since < half ? changes[i - 1].status : changes[i].status
    const turn = !flipping ? 0 : since < half ? since / half : ease.outCubic((since - half) / (dur - half)) - 1
    card.badge.style.setProperty('--c', `var(--${status})`)
    card.badge.style.transform = turn ? `perspective(120px) rotateX(${turn * 88}deg)` : ''
    text(card.badgeText, LABEL[status])
  }

  function updateSpark(card, t, off, n) {
    const { runs } = card.project
    const dx = (SPARK.w - SPARK.pad * 2) / (SLOTS - 1)
    const floor = SPARK.h - SPARK.pad
    const pts = []
    for (let j = Math.max(0, Math.floor(off) - 1); j <= SLOTS - 1 + n; j++)
      pts.push(`${(SPARK.pad + (j - off) * dx).toFixed(2)},${(floor - runs[j].pct * (SPARK.h - SPARK.pad * 2)).toFixed(2)}`)
    const drawn = ease.outCubic(prog(t, card.revealAt + 0.2, card.revealAt + 0.9))
    card.line.setAttribute('points', pts.join(' '))
    card.line.style.strokeDashoffset = 1 - drawn
    card.area.setAttribute('points', `${pts[0].split(',')[0]},${floor} ${pts.join(' ')} ${pts.at(-1).split(',')[0]},${floor}`)
    card.area.style.opacity = drawn
  }

  function updateBars(card, t, tf, off, spot) {
    for (let j = 0; j < card.bars.length; j++) {
      const bar = card.bars[j]
      const s = j - off
      const shown = s > -1 && s < SLOTS && t >= bar.birth
      if (shown !== bar.shown) {
        bar.shown = shown
        bar.el.style.display = shown ? '' : 'none'
      }
      if (!shown)
        continue

      const grown = card.isHero && j < SLOTS
        ? spring(prog(t, bar.birth, bar.birth + 0.42), 0.42)
        : spring(prog(t, bar.birth, bar.birth + 0.34), 0.55)
      // The oldest run fades as it is pushed off the left end.
      const leaving = s < 0 ? 1 + s : 1
      let status = bar.run.status
      let opacity = 0.8 * leaving
      let scale = 1
      let nudge = 0
      let flash = 0.6 * pulse(t, bar.birth, 0.36)

      if (card.isHero) {
        const lock = lockAt.get(j)
        if (lock == null) {
          opacity *= 1 - 0.74 * spot
        }
        else {
          // A flaky run is one that could not make up its mind: until the reticle
          // locks, it stutters between passing and failing. Keyed to the frame, not
          // the sub-frame, so motion blur never smears it into brown.
          if (t >= CUE.flicker && t < lock) {
            const tick = Math.floor(tf * 30)
            const urgency = prog(t, CUE.flicker, lock)
            if (hash(tick * 3.17 + j * 11.3) < 0.2 + urgency * 0.65) {
              status = hash(tick * 7.31 + j) < 0.5 ? 'pass' : 'fail'
              nudge = (hash(tick * 1.7 + j * 5.1) - 0.5) * 2.4
            }
          }
          scale += 0.3 * pulse(t, lock, 0.34)
          flash = Math.max(flash, 0.75 * pulse(t, lock, 0.45))
          opacity = Math.max(opacity, lerp(0.8, 1, spot))
        }
        if (j === HERO_FAIL)
          flash = Math.max(flash, 0.95 * pulse(t, bar.birth, 0.5))
      }

      bar.el.style.transform = `translateX(${s * PITCH + nudge}px) scale(${scale},${grown * scale * lerp(0.5, 1, leaving)})`
      bar.el.style.opacity = opacity
      bar.el.style.setProperty('--c', `var(--${status})`)
      bar.el.style.setProperty('--f', flash)
    }
  }

  function updateCallouts(t, off) {
    const out = 1 - prog(t, b(19.5), b(19.9))
    reticles.forEach((reticle, i) => {
      const at = CUE.locks[i]
      const p = prog(t, at - 0.12, at + 0.06)
      reticle.style.opacity = p * out
      reticle.style.transform = `translateX(${(HERO_FLAKY[i] - off) * PITCH - 4}px) scale(${lerp(2.1, 1, ease.outCubic(p))})`
    })
    const p = prog(t, CUE.locks[1] + 0.1, CUE.locks[1] + 0.42)
    tip.style.opacity = prog(p, 0, 0.4) * out
    tip.style.left = `${(HERO_FLAKY[1] - off) * PITCH + BAR_W / 2}px`
    tip.style.transform = `translateX(-50%) translateY(${(1 - spring(p, 0.6)) * 8}px) scale(${lerp(0.9, 1, spring(p, 0.6))})`
  }

  function update(t, tf) {
    const visible = t < dv1 + 0.02
    el.style.display = visible ? '' : 'none'
    if (!visible)
      return
    const cam = camAt(t)
    plane.look(cam)
    // Past this zoom only the failing bar matters; the portal carries it from here.
    el.style.opacity = 1 - prog(Math.log(cam.zoom), Math.log(18), Math.log(70))

    // Bar 5 racks focus onto the hero card.
    const focus = WHIP(prog(t, pi0, pi0 + 0.9))
    const spot = ease.outCubic(prog(t, ...CUE.spotlight)) * (1 - prog(t, b(19.55), b(19.95)))

    let passing = 0
    let totalRuns = 0
    let failing = 0
    for (const card of cards) {
      const { project } = card
      const n = arrived(project, t)
      const off = tape(project, t)
      const latest = project.runs[SLOTS - 1 + n]
      passing += latest.pct * project.tests
      totalRuns += 30 + n
      if (latest.status === 'fail')
        failing++

      if (card.isHero) {
        // During bar 2 the strip floats alone; the card grows around it on the pull back.
        card.bg.style.opacity = ease.outCubic(prog(t, pb0 + 0.1, pb0 + 0.5))
        card.chrome.style.opacity = ease.outCubic(prog(t, pb0 + 0.22, pb0 + 0.6))
      }
      else {
        const r = ease.outExpo(prog(t, card.revealAt, card.revealAt + 0.75))
        card.root.style.opacity = ease.outCubic(prog(t, card.revealAt, card.revealAt + 0.3)) * lerp(1, 0.3, focus)
        card.root.style.transform = `translateY(${(1 - r) * 40}px) scale(${lerp(0.92, 1, r)})`
        card.root.style.filter = focus > 0.001 ? `blur(${focus * 2.5}px)` : ''
      }

      text(card.rate, formatPct(passRate(project, n)))
      text(card.runsLabel, `${30 + n} runs`)
      text(card.agoLabel, n > 0 ? 'just now' : project.ago)
      updateBadge(card, t)
      updateSpark(card, t, off, n)
      updateBars(card, t, tf, off, spot)
      if (card.isHero)
        updateCallouts(t, off)
    }

    const statsIn = pb0 + 0.5
    const s = ease.outExpo(prog(t, statsIn, statsIn + 0.75))
    statsEl.style.opacity = ease.outCubic(prog(t, statsIn, statsIn + 0.3)) * lerp(1, 0.3, focus)
    statsEl.style.transform = `translateY(${(s - 1) * 30}px)`
    statsEl.style.filter = focus > 0.001 ? `blur(${focus * 2.5}px)` : ''
    text(stat.projects, String(PROJECTS.length))
    text(stat.rate, formatPct(passing / totalTests))
    text(stat.tests, String(totalTests))
    // Runs pile up for real once time starts moving; on reveal they just spin up.
    text(stat.runs, String(Math.round(totalRuns * ease.outCubic(prog(t, statsIn, statsIn + 0.8)))))
    text(stat.failing, String(failing))
    stat.failing.style.color = `var(--${failing ? 'fail' : 'pass'})`
  }

  return { plane, update }
}
