// Boots the film either for the renderer (`?render`: render.mjs calls
// `window.__film.seek`) or as a live preview with a scrubber.
import { createFilm } from './film.js'
import { BEAT, DURATION, FPS } from './timing.js'

const params = new URLSearchParams(location.search)
const stage = document.getElementById('stage')
const stamp = document.getElementById('stamp')

createFilm(stage).then((film) => {
  function seek(t, tf = t) {
    film.seek(t, tf)
    // Burned-in timecode for contact sheets.
    if (params.has('stamp'))
      stamp.textContent = `${t.toFixed(3)}s  b${(t / BEAT).toFixed(2)}`
  }

  if (params.has('render')) {
    document.documentElement.classList.add('render')
    seek(0)
    window.__film = { seek, duration: DURATION, fps: FPS }
  }
  else {
    preview(seek)
  }
})

function preview(seek) {
  const play = document.getElementById('play')
  const scrub = document.getElementById('scrub')
  const clock = document.getElementById('clock')
  scrub.max = DURATION
  let t = 0
  let playing = true
  let last = performance.now()

  function fit() {
    const k = Math.min(innerWidth / 1920, (innerHeight - 44) / 1080)
    stage.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px,0) scale(${k})`
  }
  function show() {
    // Snap to the frame grid so the preview shows exactly what gets rendered.
    const frame = Math.min(Math.round(t * FPS), DURATION * FPS - 1)
    seek(frame / FPS)
    scrub.value = t
    clock.textContent = `${t.toFixed(2)}s  frame ${frame}`
  }
  function toggle() {
    playing = !playing
    play.textContent = playing ? 'pause' : 'play'
  }
  function tick(now) {
    if (playing)
      t = (t + (now - last) / 1000) % DURATION
    last = now
    show()
    requestAnimationFrame(tick)
  }

  play.addEventListener('click', toggle)
  scrub.addEventListener('input', () => {
    t = Number(scrub.value)
    if (playing)
      toggle()
  })
  addEventListener('keydown', (e) => {
    if (e.key === ' ')
      toggle()
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      if (playing)
        toggle()
      t = Math.min(DURATION - 1 / FPS, Math.max(0, t + (e.key === 'ArrowRight' ? 1 : -1) / FPS))
    }
  })
  addEventListener('resize', fit)
  fit()
  requestAnimationFrame(tick)
}
