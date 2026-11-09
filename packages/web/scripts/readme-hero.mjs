// Frame the website's overview screenshot into the README hero, light + dark, at 2400x1500.
// Run website-screenshots.mjs first (VIEWS=overview is enough), then:
//
//   node packages/web/scripts/readme-hero.mjs
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const SHOTS = new URL('../../../website/src/assets/screenshots/', import.meta.url).pathname
const OUT = new URL('../../../.github/assets/', import.meta.url).pathname
const W = 1200
const H = 750
const CARD = 1020
// The overview's content ends above the 900px fold: keep its top 770 CSS px (of 1440).
const CROP = 770

const THEMES = {
  light: { bg: '#ffffff', grid: 'rgb(228 228 231 / 40%)', glow: 'rgb(244 128 36 / 12%)', border: '#e4e4e7', shadow: 'rgb(0 0 0 / 16%)' },
  dark: { bg: '#09090b', grid: 'rgb(255 255 255 / 4%)', glow: 'rgb(244 128 36 / 16%)', border: 'rgb(255 255 255 / 10%)', shadow: 'rgb(0 0 0 / 60%)' },
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 })
for (const [theme, c] of Object.entries(THEMES)) {
  const img = `data:image/png;base64,${readFileSync(`${SHOTS}overview-${theme}.png`).toString('base64')}`
  await page.setContent(`<!doctype html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{width:${W}px;height:${H}px;background:${c.bg};overflow:hidden;position:relative}
    .grid{position:absolute;inset:0;background-image:linear-gradient(to right,${c.grid} 1px,transparent 1px),linear-gradient(to bottom,${c.grid} 1px,transparent 1px);background-size:56px 56px;background-position:center top}
    .glow{position:absolute;inset:0;background:radial-gradient(ellipse 55% 40% at 50% 0%,${c.glow},transparent)}
    .card{position:absolute;top:100px;left:${(W - CARD) / 2}px;width:${CARD}px;height:${CARD * CROP / 1440}px;overflow:hidden;border-radius:14px;border:1px solid ${c.border};box-shadow:0 40px 80px -30px ${c.shadow}}
    .card img{display:block;width:100%}
  </style></head><body><div class="grid"></div><div class="glow"></div><div class="card"><img src="${img}"></div></body></html>`)
  await page.locator('img').evaluate(el => el.decode())
  await page.screenshot({ path: `${OUT}readme-hero-${theme}.png` })
  console.log(`wrote readme-hero-${theme}.png`)
}
await browser.close()
