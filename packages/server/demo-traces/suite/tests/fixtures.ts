import type { Route } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { test as base } from '@playwright/test'
import { ME, ORDERS, POSTS, ROUTES } from './data'

export { expect } from '@playwright/test'

// The four demo apps (Store, Pay, Gateway, Pulse) are static pages under ../app plus the
// in-memory backend below, all served through `page.route`: the suite needs no server
// and records the same traces on every machine. Their bugs are deliberate.
const APP_DIR = new URL('../app/', import.meta.url)

const PAGES: Record<string, [RegExp, string][]> = {
  store: [[/^\/checkout$/, 'store/checkout.html']],
  pay: [[/^\/orders\/\w+$/, 'pay/order.html'], [/^\/developers\/usage$/, 'pay/usage.html']],
  gateway: [[/^\/routes\/[\w-]+$/, 'gateway/route.html']],
  pulse: [[/^\/feed$/, 'pulse/feed.html'], [/^\/profile$/, 'pulse/profile.html']],
}

const ASSETS: Record<string, string> = {
  '/style.css': 'text/css',
  '/logo.svg': 'image/svg+xml',
}

export const test = base.extend({
  page: async ({ page }, use) => {
    const backend = createBackend()
    await page.route(/^https:\/\/\w+\.demo\.kinora\.dev\//, route => serve(route, backend))
    await use(page)
  },
})

async function serve(route: Route, backend: Backend): Promise<void> {
  const url = new URL(route.request().url())
  const app = url.hostname.split('.')[0]
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/proxy/'))
    return backend(route, app, url)
  if (ASSETS[url.pathname])
    return route.fulfill({ contentType: ASSETS[url.pathname], body: await readFile(new URL(url.pathname.slice(1), APP_DIR)) })
  const page = PAGES[app]?.find(([pattern]) => pattern.test(url.pathname))
  if (!page)
    return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' })
  return route.fulfill({ contentType: 'text/html', body: await readFile(new URL(page[1], APP_DIR)) })
}

type Backend = (route: Route, app: string, url: URL) => Promise<void>

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function createBackend(): Backend {
  let pings = 0

  return async (route, app, url) => {
    const method = route.request().method()
    const key = `${app} ${method} ${url.pathname}`
    await sleep(60 + (url.pathname.length % 5) * 20)

    // Store
    if (key === 'store POST /api/discounts')
      return route.fulfill({ json: { code: route.request().postDataJSON().code, percent: 20 } })
    if (key === 'store POST /api/orders')
      return route.fulfill({ status: 201, json: { id: 'ord_1042', email: route.request().postDataJSON().email } })

    // Pay
    const order = url.pathname.match(/^\/api\/orders\/(\w+)$/)
    if (app === 'pay' && method === 'GET' && order)
      return route.fulfill({ json: ORDERS[order[1]] })
    if (key === 'pay POST /api/orders/ord_1043/capture')
      return route.fulfill({ json: { status: 'paid', charge: 'ch_3PqL8e' } })
    if (app === 'pay' && method === 'POST' && /^\/api\/orders\/\w+\/refunds$/.test(url.pathname)) {
      await sleep(900)
      return route.fulfill({ status: 502, json: { error: { code: 'processor_timeout', message: 'Card processor did not respond' } } })
    }
    if (key === 'pay GET /api/v1/ping') {
      pings++
      return route.fulfill({
        headers: { 'x-ratelimit-limit': '10', 'x-ratelimit-remaining': String(Math.max(0, 10 - pings)) },
        json: { pong: true },
      })
    }

    // Gateway
    const gatewayRoute = url.pathname.match(/^\/api\/routes\/([\w-]+)$/)
    if (app === 'gateway' && gatewayRoute)
      return route.fulfill({ json: ROUTES[gatewayRoute[1]] })
    if (key === 'gateway GET /proxy/v1/orders/42') {
      await sleep(250)
      return route.fulfill({
        status: 503,
        headers: { 'x-gateway-attempts': '2' },
        json: { error: 'upstream_unavailable', attempts: [{ status: 503, ms: 41 }, { status: 503, ms: 212 }] },
      })
    }
    if (key === 'gateway GET /proxy/v1/exports/orders.ndjson') {
      const rows = Array.from({ length: 5000 }, (_, i) => JSON.stringify({ id: 10_000 + i, total: 29 + (i % 7) * 10 }))
      return route.fulfill({ contentType: 'application/x-ndjson', headers: { 'x-gateway-attempts': '1' }, body: `${rows.join('\n')}\n` })
    }

    // Pulse
    if (key === 'pulse GET /api/feed') {
      const cursor = url.searchParams.get('cursor')
      const start = cursor === '' ? 0 : cursor === 'c_10' ? 10 : 20
      return route.fulfill({ json: { items: POSTS.slice(start, start + 10), next_cursor: start === 0 ? 'c_10' : null } })
    }
    if (key === 'pulse GET /api/me')
      return route.fulfill({ json: ME })
    if (key === 'pulse POST /api/me/avatar')
      return route.fulfill({ json: { url: 'https://cdn.demo.kinora.dev/avatars/alex-morgan.svg' } })

    return route.fulfill({ status: 404, json: { error: 'not_found' } })
  }
}
