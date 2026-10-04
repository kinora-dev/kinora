// The trace viewer window: actions list, timeline, and the snapshot deck that
// riffles like the flip-card reel kinora is named after.
import { actionAt, ACTIONS, ERROR_ACTION, FIRST_ACTION, FLIP_TIMES, FRAMES, headAt } from './data.js'
import { ease, lerp, lerpLog, prog, pulse, spring } from './ease.js'
import { Plane } from './plane.js'
import { CUE } from './timing.js'

const W = 860
const H = 560
// The action track's inner box, in window coordinates (see .tw-track .in).
const TRACK = { x: 241, y: 125, w: 610, h: 16 }
const TOTAL_ACTIONS = 28
const FLIP = 0.24

// Segments sit on whole pixels so the portal can land on one exactly.
function segRect([from, to]) {
  const left = Math.round(from / 100 * TRACK.w)
  return { x: TRACK.x + left, y: TRACK.y, w: Math.round(to / 100 * TRACK.w) - left, h: TRACK.h }
}

function segStyle(seg) {
  const rect = segRect(seg)
  return `left:${rect.x - TRACK.x}px;width:${rect.w}px`
}

/** The failing action's segment: the dive lands inside it. */
export const ERROR_SEG = segRect(ACTIONS[ERROR_ACTION].seg)

/** Window coordinates of the playhead. */
export function headPoint(t) {
  return { x: TRACK.x + headAt(t) / 100 * TRACK.w, top: TRACK.y, bottom: TRACK.y + TRACK.h }
}

const [e0, e1] = CUE.emerge
const [c0] = CUE.collapse
const VIEW = { fx: W / 2, fy: H / 2, sx: 1300, sy: 548, zoom: 1.42, rx: 4, ry: -9, rz: -0.8 }

// Starts so deep inside the red segment that it fills the frame, then falls
// back fast and settles slow. The pan to frame the whole window rides on the
// back of that fall, and the tilt only comes in once the window reads.
export function camAt(t) {
  const p = prog(t, e0, e1)
  const travel = ease.inOutCubic(prog(p, 0.04, 0.62))
  const tilt = ease.inOutCubic(prog(p, 0.25, 1))
  const idle = ease.inOutSine(prog(t, e1 - 0.4, c0 + 0.5))
  const fold = ease.inCubic(prog(t, c0, c0 + 0.8))
  return {
    fx: lerp(ERROR_SEG.x + ERROR_SEG.w / 2, VIEW.fx, travel),
    fy: lerp(ERROR_SEG.y + ERROR_SEG.h / 2, VIEW.fy, travel),
    sx: lerp(960, VIEW.sx, travel),
    sy: lerp(540, VIEW.sy, travel),
    zoom: lerpLog(80, VIEW.zoom, ease.outExpo(p)) * (1 + 0.03 * idle) * lerp(1, 0.82, fold),
    rx: VIEW.rx * tilt,
    ry: (VIEW.ry + 2.5 * idle) * tilt,
    rz: VIEW.rz * tilt,
  }
}

function icon(paths, color) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`
}
const CHECK = '<path d="M20 6 9 17l-5-5" />'
const CROSS = '<path d="M18 6 6 18" /><path d="m6 6 12 12" />'
const CHEVRON_DOWN = '<path d="m6 9 6 6 6-6" />'
const CHEVRON_LEFT = '<path d="m15 18-6-6 6-6" />'
const CHEVRON_RIGHT = '<path d="m9 18 6-6-6-6" />'
const PLAY = '<path d="M6 3 20 12 6 21Z" />'

function actionHtml(a, i) {
  const mark = a.status === 'error'
    ? icon(CROSS, 'var(--fail)')
    : a.group
      ? icon(CHEVRON_DOWN, 'var(--muted-foreground)')
      : a.status === 'ok' ? icon(CHECK, 'var(--pass)') : icon('', 'none')
  return `<div class="act" data-act="${i}" style="padding-left:${10 + a.depth * 14}px">${mark}<span class="t">${a.title}</span><span class="d">${a.took}</span></div>`
}

// What the page under test looks like after each scrubbed action: it loads,
// fills in, gets submitted, and is declined.
const PAGE_STATES = [
  { load: 0.15 },
  { load: 0.5 },
  { load: 0.85 },
  { page: true },
  { page: true, assets: true },
  { page: true, assets: true, cart: true },
  { page: true, assets: true, cart: true, details: true },
  { page: true, assets: true, cart: true, details: true, pressed: true },
  { page: true, assets: true, cart: true, details: true, pressed: true, declined: true },
]

const SKELETON = [[110, 20, 0], ['100%', 36, 18], [170, 31, 16], [292, 28, 8], [210, 40, 12], [108, 24, 9]]
  .map(([w, h, gap]) => `<i style="width:${typeof w === 'number' ? `${w}px` : w};height:${h}px;margin-top:${gap}px"></i>`)
  .join('')

function stepHtml(done, bad, title, sub) {
  const tick = done ? `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round" style="margin-left:4px">${CHECK}</svg>` : ''
  return `<div class="pg-step${done ? ' done' : ''}${bad ? ' bad' : ''}"><b>${title}</b>${tick}<small>${sub}</small></div>`
}

function pageHtml(s, k) {
  if (!s.page) {
    return `<div class="page">
      <div class="pg sk"><div class="pg-main">${SKELETON}</div><div class="pg-side"></div></div>
      <div class="pg-load" style="width:${s.load * 100}%"></div><div class="shade"></div>
    </div>`
  }
  const side = s.assets
    ? '<h4>Order summary</h4><div>Kinora Pro<b>$29</b></div><div>Team seats<b>1</b></div><div>Trace retention<b>90 days</b></div><div>Total due today<b>$29</b></div>'
    : ''
  return `<div class="page">
    <div class="pg">
      <div class="pg-main">
        <div class="pg-brand"><span class="pg-logo"${s.assets ? '' : ' style="background:#e4e4e7"'}>${s.assets ? 'K' : ''}</span>Kinora Store</div>
        <div class="pg-steps">
          ${stepHtml(s.cart, false, 'Cart', 'Pro plan selected')}
          ${stepHtml(s.details, false, 'Details', s.details ? 'Customer ready' : 'Your email')}
          ${stepHtml(false, s.declined, 'Confirm', s.declined ? 'Payment declined' : s.pressed ? 'Processing' : 'Review and pay')}
        </div>
        <div class="pg-h1">Checkout${k === FRAMES - 1 ? '<span class="pg-hl"></span>' : ''}</div>
        <div class="pg-p">Kinora Pro for one seat, billed monthly. Change seats or cancel whenever you like.</div>
        <div class="pg-field">Customer email<div class="pg-input">${s.details ? 'alex@example.com' : ''}</div></div>
        <div class="pg-btn${s.pressed ? ' pressed' : ''}">${s.pressed && !s.declined ? 'Processing…' : 'Complete order'}</div>
      </div>
      <div class="pg-side">${side}</div>
    </div>
    <div class="shade"></div>
  </div>`
}

function html() {
  const scrubbed = ACTIONS.filter(a => a.seg)
  const segments = [
    `<div class="seg step" style="${segStyle([0, 9.5])}"></div>`,
    ...scrubbed.map(a => `<div class="seg ${a.status}" data-seg="${ACTIONS.indexOf(a)}" style="${segStyle(a.seg)}"></div>`),
    `<div class="seg step" style="${segStyle([97.5, 100])}"></div>`,
  ]
  // Screencast frames along the filmstrip, evenly spaced like a real recording.
  const thumbs = [10, 20.5, 31, 41.5, 52.5, 63, 73.5, 84].map((left, i) => `<div class="thumb${i ? ' built' : ''}" style="left:${left}%"></div>`)
  return `<div class="tw">
    <div class="tw-head"><span class="mono">trace</span><span>checkout.spec.ts:4 › <b>completes checkout</b></span></div>
    <div class="tw-actions">
      <div class="tw-actions-head">Actions <span>${TOTAL_ACTIONS}</span></div>
      ${ACTIONS.map(actionHtml).join('')}
    </div>
    <div class="tw-main">
      <div class="tw-bar">
        ${icon(PLAY, 'currentColor')}${icon(CHEVRON_LEFT, 'currentColor')}${icon(CHEVRON_RIGHT, 'currentColor')}
        <span>1x</span><span class="now"></span><span class="at"></span><span class="pos"></span>
      </div>
      <div class="tw-film"><div class="in">${thumbs.join('')}</div></div>
      <div class="tw-track"><div class="in">${segments.join('')}</div></div>
      <div class="tw-snap">
        <div class="browser">
          <div class="browser-chrome">
            <i style="background:var(--fail)"></i><i style="background:var(--flaky)"></i><i style="background:var(--pass)"></i>
            <span>demo.kinora.dev/checkout</span>
          </div>
          <div class="pages">${PAGE_STATES.map(pageHtml).join('')}</div>
        </div>
        <div class="tw-error">Error: expect(locator).toHaveText(expected)
Expected: "Order complete"
Received: "Checkout"</div>
      </div>
    </div>
  </div>`
}

function text(node, value) {
  if (node.textContent !== value)
    node.textContent = value
}

export function createTrace(el) {
  el.innerHTML = html()
  const plane = new Plane(el)
  const rows = [...el.querySelectorAll('.act')]
  const segs = [...el.querySelectorAll('[data-seg]')]
  const thumbs = [...el.querySelectorAll('.thumb')]
  const pages = [...el.querySelectorAll('.page')]
  const shades = pages.map(page => page.querySelector('.shade'))
  const now = el.querySelector('.now')
  const at = el.querySelector('.at')
  const pos = el.querySelector('.pos')
  const error = el.querySelector('.tw-error')
  const highlight = el.querySelector('.pg-hl')

  function update(t) {
    const visible = t >= e0 - 0.02 && t < c0 + 0.44
    el.style.display = visible ? '' : 'none'
    if (!visible)
      return
    const cam = camAt(t)
    plane.look(cam)
    // Gone before the dot lands as the logo.
    const fold = prog(t, c0 + 0.02, c0 + 0.42)
    el.style.opacity = prog(Math.log(cam.zoom), Math.log(16), Math.log(6)) * (1 - ease.inOutCubic(fold))
    el.style.filter = fold > 0 ? `blur(${fold * 10}px)` : ''

    const current = t < CUE.scrub[0] ? FIRST_ACTION : actionAt(t)
    const selected = t >= CUE.headIn
    const locked = pulse(t, CUE.lock, 0.5)
    text(now, ACTIONS[current].title)
    text(at, ACTIONS[current].at)
    text(pos, `${current + 1} / ${TOTAL_ACTIONS}`)

    rows.forEach((row, i) => {
      const rowIn = e0 + 0.3 + i * 0.02
      const p = ease.outCubic(prog(t, rowIn, rowIn + 0.3))
      row.style.opacity = p
      row.style.transform = `translateX(${(p - 1) * 16}px)`
      const sel = selected && i === current ? 1 : 0
      row.style.setProperty('--sel', i === ERROR_ACTION ? sel * (1 + 1.4 * locked) : sel)
    })
    segs.forEach((seg) => {
      seg.style.setProperty('--sel', selected && Number(seg.dataset.seg) === current ? 1 : 0)
    })
    thumbs.forEach((thumb, k) => {
      const thumbIn = e0 + 0.42 + k * 0.035
      thumb.style.transform = `scale(${spring(prog(t, thumbIn, thumbIn + 0.4), 0.6)})`
    })

    // The deck. Each card falls toward the camera on its bottom edge when the
    // playhead reaches the next action, uncovering the snapshot beneath it.
    const flipped = FLIP_TIMES.filter(at => t >= at).length
    pages.forEach((page, k) => {
      const flipAt = FLIP_TIMES[k]
      const p = flipAt == null ? 0 : prog(t, flipAt, flipAt + FLIP)
      const hidden = p >= 1 || k > flipped + 1
      page.style.display = hidden ? 'none' : ''
      if (hidden)
        return
      page.style.zIndex = FRAMES - k
      page.style.transform = `rotateX(${-ease.inQuad(p) * 100}deg)`
      page.style.opacity = 1 - prog(p, 0.5, 0.95)
      // A falling card darkens, and shades the one it uncovers until it is clear.
      const above = k > 0 ? prog(t, FLIP_TIMES[k - 1], FLIP_TIMES[k - 1] + FLIP) : 1
      shades[k].style.opacity = Math.max(p * 0.3, (1 - above) * 0.28)
    })

    const hit = prog(t, CUE.lock + 0.04, CUE.lock + 0.3)
    highlight.style.opacity = prog(hit, 0, 0.3)
    highlight.style.transform = `scaleX(${ease.outExpo(hit)})`
    const rise = prog(t, CUE.lock + 0.1, CUE.lock + 0.62)
    error.style.opacity = prog(rise, 0, 0.3)
    error.style.transform = `translateY(${(1 - spring(rise, 0.62)) * 46}px)`
  }

  return { plane, update }
}
