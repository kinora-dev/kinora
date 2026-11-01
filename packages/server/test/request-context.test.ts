import type { ErrorEvent } from '@sentry/node'
import * as Sentry from '@sentry/node'
import { Hono } from 'hono'
import { contextStorage } from 'hono/context-storage'
import { requestId } from 'hono/request-id'
import { describe, expect, it, vi } from 'vitest'
import { app } from '../src/app'
import { logContext, logger } from '../src/lib/logger'
import { sentryScope } from '../src/lib/request-context'

describe('request context', () => {
  it('tags log lines with the request id and org, wherever they are logged in the request', async () => {
    const probe = new Hono()
      .use(contextStorage())
      .use(requestId())
      .use(async (c, next) => {
        c.set('orgId', 'org-1')
        await next()
      })
      .get('/', async (c) => {
        await new Promise(resolve => setTimeout(resolve, 1))
        return c.json(logContext())
      })

    const body = await (await probe.request('/', { headers: { 'X-Request-Id': 'req-abc' } })).json()
    expect(body).toEqual({ requestId: 'req-abc', orgId: 'org-1' })
    expect(logContext()).toEqual({})
  })

  it('logs a rejected request as a warning naming its method, path and status', async () => {
    const warn = vi.spyOn(logger, 'warn')
    await app.request('/api/v1/runs', { method: 'POST' }) // 401: no API key
    await app.request('/api/slack/install') // no session

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'POST', path: '/api/v1/runs', status: 401, ip: expect.any(String) }),
      'POST /api/v1/runs 401',
    )
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'GET', path: '/api/slack/install' }),
      expect.stringMatching(/^GET \/api\/slack\/install 4\d\d$/),
    )
    warn.mockRestore()
  })

  it('logs dashboard and auth requests too, but not a passing healthcheck', async () => {
    const info = vi.spyOn(logger, 'info')
    await app.request('/healthcheck')
    await app.request('/api/auth/ok')

    const messages = info.mock.calls.map(call => call[1])
    expect(messages).toContain('GET /api/auth/ok 200')
    expect(messages.some(m => typeof m === 'string' && m.startsWith('GET /healthcheck'))).toBe(false)
    info.mockRestore()
  })

  it('returns a request id header on app responses', async () => {
    const res = await app.request('/healthcheck')
    expect(res.headers.get('X-Request-Id')).toMatch(/^[\w-]+$/)
  })

  it('tags the Sentry errors of each request with its own request id, even concurrently', async () => {
    const events: ErrorEvent[] = []
    Sentry.init({
      dsn: 'https://public@sentry.example.com/1',
      defaultIntegrations: false,
      beforeSend(event) {
        events.push(event)
        return null
      },
    })

    const server = new Hono()
      .use(requestId())
      .use(sentryScope)
      .get('/fail/:delay', async (c) => {
        // Interleave the two requests between tagging and capturing.
        await new Promise(resolve => setTimeout(resolve, Number(c.req.param('delay'))))
        Sentry.captureException(new Error(`failed in ${c.get('requestId')}`))
        return c.text(c.get('requestId'))
      })

    const [slow, fast] = await Promise.all([server.request('/fail/30'), server.request('/fail/5')])
    await Sentry.flush(1000)

    const ids = [await slow.text(), await fast.text()]
    expect(events).toHaveLength(2)
    for (const event of events)
      expect(event.exception?.values?.[0]?.value).toBe(`failed in ${String(event.tags?.requestId)}`)
    expect(events.map(e => e.tags?.requestId).sort()).toEqual([...ids].sort())
  })
})
