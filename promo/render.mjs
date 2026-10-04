#!/usr/bin/env node
// Renders the kinora promo film (promo/index.html) to video.
//
// The film is a pure function of time, so this seeks it instant by instant in
// headless Chromium, using the Playwright the workspace already ships. Each
// frame is several instants, captured at twice the output size, then scaled
// down and averaged in linear light: real motion blur, supersampled edges.
//
//   node promo/render.mjs                    1080p60 master -> promo/out/kinora-promo.mp4 (+ -silent.mp4)
//   node promo/render.mjs --draft            quick 30fps pass, no motion blur
//   node promo/render.mjs --range 9.4,11.3   only that stretch, at full quality
//   node promo/render.mjs --still 3.2,7.5    PNG stills at the given seconds
//   node promo/render.mjs --sheet 8,10.5,12  contact sheet: from,to[,count]
//   node promo/render.mjs --preview          serve the film with a scrubber
import { Buffer } from 'node:buffer'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { createReadStream, existsSync } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { writeSoundtrack } from './audio.mjs'
import { DURATION, FPS } from './src/timing.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const out = path.join(here, 'out')

// Reuse what the workspace already has: Playwright from the web e2e suite and
// the brand fonts from @kinora/ui.
const { chromium } = createRequire(path.join(root, 'packages/web/package.json'))('@playwright/test')
const ui = createRequire(path.join(root, 'packages/ui/package.json'))
const FONTS = {
  '/fonts/hanken-grotesk.woff2': ui.resolve('@fontsource-variable/hanken-grotesk/files/hanken-grotesk-latin-wght-normal.woff2'),
  '/fonts/jetbrains-mono.woff2': ui.resolve('@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2'),
}
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.woff2': 'font/woff2', '.wav': 'audio/wav' }
const SIZE = { width: 1920, height: 1080 }

const { values: opt } = parseArgs({
  options: {
    still: { type: 'string' },
    sheet: { type: 'string' },
    range: { type: 'string' },
    draft: { type: 'boolean', default: false },
    preview: { type: 'boolean', default: false },
    // Instants averaged per frame, and how much of the frame interval they span.
    samples: { type: 'string', default: '16' },
    shutter: { type: 'string', default: '0.75' },
    // Capture at this multiple of 1080p, then scale down.
    scale: { type: 'string', default: '2' },
    workers: { type: 'string', default: String(Math.max(1, Math.min(10, os.availableParallelism() - 2))) },
    name: { type: 'string', default: 'kinora-promo' },
  },
})

function log(message) {
  process.stdout.write(`${message}\n`)
}

function serve() {
  const server = createServer((req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost')
    const file = FONTS[pathname] ?? path.join(here, pathname === '/' ? 'index.html' : pathname)
    if ((!FONTS[pathname] && !file.startsWith(here + path.sep)) || !existsSync(file)) {
      res.writeHead(404).end()
      return
    }
    res.writeHead(200, { 'content-type': MIME[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' })
    createReadStream(file).pipe(res)
  })
  return new Promise((resolve) => {
    server.listen(opt.preview ? 4173 : 0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}` }))
  })
}

// Full Chromium with the GPU on: rasterizing a 4K frame is far quicker than in
// the headless shell's software renderer.
function launch() {
  return chromium.launch({
    channel: 'chromium',
    args: ['--force-color-profile=srgb', '--font-render-hinting=none', '--disable-lcd-text', '--enable-gpu', '--use-angle=metal', '--enable-gpu-rasterization'],
  })
}

async function openFilm(browser, url, { scale = 1, stamp = false } = {}) {
  const page = await browser.newPage({ viewport: SIZE, deviceScaleFactor: scale })
  page.on('pageerror', (error) => {
    console.error(error)
    process.exit(1)
  })
  await page.goto(`${url}/index.html?render${stamp ? '&stamp' : ''}`)
  await page.waitForFunction(() => window.__film)
  return page
}

function seek(page, t, tf = t) {
  return page.evaluate(([at, frame]) => window.__film.seek(at, frame), [t, tf])
}

function ffmpeg(args, { pipe = false } = {}) {
  const child = spawn('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: [pipe ? 'pipe' : 'ignore', 'inherit', 'inherit'] })
  const done = once(child, 'exit').then(([code]) => {
    if (code !== 0)
      throw new Error(`ffmpeg exited with ${code}`)
  })
  return { stdin: child.stdin, done }
}

async function stills(url, times) {
  const dir = path.join(out, 'stills')
  await mkdir(dir, { recursive: true })
  const browser = await launch()
  const page = await openFilm(browser, url)
  for (const t of times) {
    await seek(page, t)
    const file = path.join(dir, `${t.toFixed(3)}.png`)
    await page.screenshot({ path: file })
    log(file)
  }
  await browser.close()
}

async function sheet(url, [from, to, count = 12]) {
  const dir = path.join(out, '.sheet')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
  const browser = await launch()
  const page = await openFilm(browser, url, { stamp: true })
  for (let i = 0; i < count; i++) {
    await seek(page, from + (to - from) * i / (count - 1))
    await page.screenshot({ path: path.join(dir, `${String(i).padStart(3, '0')}.png`) })
  }
  await browser.close()
  const cols = count <= 6 ? 3 : 4
  const file = path.join(out, `sheet-${from}-${to}.png`)
  await ffmpeg(['-framerate', '1', '-i', path.join(dir, '%03d.png'), '-vf', `scale=640:-2:flags=lanczos,tile=${cols}x${Math.ceil(count / cols)}:padding=6:color=0x444444`, '-frames:v', '1', file]).done
  await rm(dir, { recursive: true, force: true })
  log(file)
}

// One worker, one browser: renders a contiguous run of frames into a lossless chunk.
async function renderChunk(url, { index, first, last, fps, samples, shutter, scale, dir, progress }) {
  const browser = await launch()
  const page = await openFilm(browser, url, { scale })
  const cdp = await page.context().newCDPSession(page)
  const file = path.join(dir, `chunk-${String(index).padStart(2, '0')}.mkv`)
  // Everything between the two luts happens in linear light, so the scale-down
  // and the blur mix brightness the way a lens and a sensor would.
  const lut = power => ['r', 'g', 'b'].map(c => `${c}='pow(val/maxval\\,${power})*maxval'`).join(':')
  const filters = [
    'format=gbrp16le',
    `lutrgb=${lut(2.2)}`,
    scale > 1 ? `scale=${SIZE.width}:${SIZE.height}:flags=lanczos` : null,
    samples > 1 ? `tmix=frames=${samples},select='not(mod(n+1\\,${samples}))',setpts=N/(${fps}*TB)` : null,
    `lutrgb=${lut(1 / 2.2)}`,
  ].filter(Boolean).join(',')
  const encoder = ffmpeg(['-f', 'image2pipe', '-framerate', String(fps * samples), '-c:v', 'mjpeg', '-i', '-', '-vf', filters, '-r', String(fps), '-c:v', 'ffv1', '-level', '3', '-pix_fmt', 'gbrp16le', file], { pipe: true })
  for (let frame = first; frame < last; frame++) {
    for (let k = 0; k < samples; k++) {
      const t = Math.max(0, (frame + shutter * ((k + 0.5) / samples - 0.5)) / fps)
      await seek(page, t, frame / fps)
      // The clip's scale is what makes the capture honour the device scale
      // factor. JPEG at 100 is visually lossless here and several times
      // quicker to encode than a 4K PNG.
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 100, optimizeForSpeed: true, clip: { x: 0, y: 0, ...SIZE, scale } })
      if (!encoder.stdin.write(Buffer.from(data, 'base64')))
        await once(encoder.stdin, 'drain')
    }
    progress()
  }
  encoder.stdin.end()
  await Promise.all([encoder.done, browser.close()])
  return file
}

async function render(url) {
  const fps = opt.draft ? 30 : FPS
  const samples = opt.draft ? 1 : Number(opt.samples)
  const scale = opt.draft ? 1 : Number(opt.scale)
  const workers = Number(opt.workers)
  const [from, to] = opt.range ? opt.range.split(',').map(Number) : [0, DURATION]
  const start = Math.round(from * fps)
  const frames = Math.round(to * fps) - start
  const dir = path.join(out, '.chunks')
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })

  let done = 0
  const started = Date.now()
  const progress = () => {
    done++
    if (process.stdout.isTTY)
      process.stdout.write(`\r  frame ${done}/${frames}  ${((Date.now() - started) / 1000).toFixed(0)}s`)
  }
  log(`rendering ${frames} frames at ${fps}fps: ${samples} instants each, captured at ${scale}x, ${workers} workers`)
  const per = Math.ceil(frames / workers)
  const chunks = await Promise.all(Array.from({ length: workers }, (_, index) => {
    const first = start + index * per
    const last = Math.min(start + frames, first + per)
    return first < last ? renderChunk(url, { index, first, last, fps, samples, shutter: Number(opt.shutter), scale, dir, progress }) : null
  }))
  if (process.stdout.isTTY)
    log('')

  const list = path.join(dir, 'chunks.txt')
  await writeFile(list, chunks.filter(Boolean).map(file => `file '${file}'`).join('\n'))
  const base = path.join(out, `${opt.name}${opt.draft ? '-draft' : ''}${opt.range ? `-${from}-${to}` : ''}`)
  const silent = `${base}-silent.mp4`
  // A whisper of grain keeps the dark gradients from banding once it is 8-bit H.264.
  const filters = [
    'scale=in_range=pc:out_range=tv:out_color_matrix=bt709',
    'format=yuv420p',
    opt.draft ? null : 'noise=c0s=5:c0f=t+u',
    'setparams=range=tv:color_primaries=bt709:color_trc=bt709:colorspace=bt709',
  ].filter(Boolean).join(',')
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', filters, '-c:v', 'libx264', '-preset', opt.draft ? 'veryfast' : 'slow', '-crf', opt.draft ? '20' : '17', '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', silent]).done
  await rm(dir, { recursive: true, force: true })

  // The soundtrack is synthesized from the same cue sheet the picture runs on.
  const wav = `${base}.wav`
  await writeSoundtrack(wav, { from, to })
  await ffmpeg(['-i', silent, '-i', wav, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-movflags', '+faststart', '-shortest', `${base}.mp4`]).done
  await rm(wav)
  log(`${base}.mp4 and ${path.basename(silent)}  (${((Date.now() - started) / 1000).toFixed(0)}s)`)
}

async function main() {
  const { server, url } = await serve()
  if (opt.preview) {
    log(`preview: ${url}  (space: play/pause, arrows: step a frame)`)
    return
  }
  await mkdir(out, { recursive: true })
  try {
    if (opt.still)
      await stills(url, opt.still.split(',').map(Number))
    else if (opt.sheet)
      await sheet(url, opt.sheet.split(',').map(Number))
    else
      await render(url)
  }
  finally {
    server.close()
  }
}

main()
