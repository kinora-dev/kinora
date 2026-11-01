import { serveStatic } from '@hono/node-server/serve-static'
import { trpcServer } from '@hono/trpc-server'
import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { contextStorage } from 'hono/context-storage'
import { cors } from 'hono/cors'
import { requestId } from 'hono/request-id'
import { secureHeaders } from 'hono/secure-headers'
import { db } from './db'
import { demoApp } from './demo/session'
import { verifyArtifactSignature } from './lib/artifact-url'
import { auth } from './lib/auth'
import { blockAuthWritesInDemo, blockInDemo } from './lib/demo-guard'
import { env } from './lib/env'
import { logger } from './lib/logger'
import { clientIp, rateLimit } from './lib/rate-limit'
import { requestLogger, sentryScope } from './lib/request-context'
import { getTrustedOrigins } from './lib/utils'
import { publicApi } from './public-api/index'
import { appRouter } from './router/index'
import { slackOAuth } from './slack/oauth'
import { createContext } from './trpc/context'

const app = new Hono()

// First in the chain: every log line of a request carries its id (X-Request-Id, reused when the
// caller sends one), and the request log sees rate-limit (429) / body-limit (413) rejections too.
app.use(contextStorage())
app.use(requestId())
app.use(sentryScope)
app.use(requestLogger)

// Public artifacts (trace.zip etc): permissive CORS + range. Registered before
// secureHeaders/global-cors so its CORP doesn't block the viewer's cross-origin
// service-worker fetch. serveStatic ends the chain when the file exists.
app.use('/artifacts/*', cors({ origin: '*' }))
// CORS stays permissive (the viewer's SW fetches cross-origin); the HMAC signature is the gate.
app.use('/artifacts/*', async (c, next) => {
  const key = c.req.path.slice('/artifacts/'.length)
  if (!verifyArtifactSignature(key, c.req.query('exp'), c.req.query('sig')))
    return c.json({ error: 'Forbidden' }, 403)
  return next()
})
app.use('/artifacts/*', serveStatic({
  root: env.STORAGE_DIR,
  rewriteRequestPath: path => path.replace(/^\/artifacts/, ''),
}))

app.use(secureHeaders())
app.use('*', cors({ origin: getTrustedOrigins(), credentials: true }))

// Public route: only statuses go out, the error (host, port, user) stays in the logs.
app.get('/healthcheck', async (c) => {
  try {
    await db.execute(sql`SELECT 1`)
    return c.json({ status: 'ok', services: { db: { status: 'ok' } } })
  }
  catch (err) {
    logger.error({ err }, 'healthcheck: database unreachable')
    return c.json({ status: 'error', services: { db: { status: 'error' } } }, 503)
  }
})

app.use('/api/auth/*', blockAuthWritesInDemo)
app.on(['POST', 'GET'], '/api/auth/*', c => auth.handler(c.req.raw))

app.use('/trpc/*', rateLimit({ windowMs: 60_000, limit: env.TRPC_RATE_LIMIT }))
app.use('/trpc/*', trpcServer({ router: appRouter, createContext }))

// Read-only demo: reject all ingest writes.
app.use('/api/v1/*', blockInDemo)
// Per-IP, before the body is read, so a flood is cheap to reject. Keyed by IP (not token) so
// sharded CI spreads across runner IPs instead of summing into one bucket. Real throttle is
// nginx limit_req (unspoofable IP); this is the backstop.
app.use('/api/v1/*', rateLimit({ windowMs: 60_000, limit: env.INGEST_RATE_LIMIT, key: clientIp }))
// Largest legitimate ingest body is a trace.zip artifact; cap before any parsing.
app.use('/api/v1/*', bodyLimit({
  maxSize: 100 * 1024 * 1024,
  onError: c => c.json({ error: 'Payload too large' }, 413),
}))
app.route('/api/v1', publicApi)

// Read-only demo: the Slack OAuth callback writes the integration (bypassing tRPC), so block it here.
app.use('/api/slack/*', blockInDemo)
app.route('/api/slack', slackOAuth)

// Demo-only: establishes the shared read-only session cookie (no-op otherwise).
app.route('/api/demo', demoApp)

app.onError((err, c) => {
  logger.error({ err, method: c.req.method, path: c.req.path }, 'unhandled request error')
  Sentry.captureException(err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

export { app }
