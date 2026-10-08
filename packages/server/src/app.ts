import { serveStatic } from '@hono/node-server/serve-static'
import { trpcServer } from '@hono/trpc-server'
import * as Sentry from '@sentry/node'
import { sql } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { cors } from 'hono/cors'
import { secureHeaders } from 'hono/secure-headers'
import { db } from './db'
import { demoApp } from './demo/session'
import { accessLog } from './lib/access-log'
import { verifyArtifactSignature } from './lib/artifact-url'
import { auth } from './lib/auth'
import { blockAuthWritesInDemo, blockInDemo } from './lib/demo-guard'
import { env } from './lib/env'
import { logger } from './lib/logger'
import { clientIp, rateLimit } from './lib/rate-limit'
import { getTrustedOrigins } from './lib/utils'
import { publicApi } from './public-api/index'
import { appRouter } from './router/index'
import { slackOAuth } from './slack/oauth'
import { createContext } from './trpc/context'

const app = new Hono()

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

app.get('/healthcheck', async (c) => {
  try {
    await db.execute(sql`SELECT 1`)
    return c.json({ status: 'ok' })
  }
  catch {
    return c.json({ status: 'error', message: 'database unreachable' }, 503)
  }
})

app.use('/api/auth/*', blockAuthWritesInDemo)
app.on(['POST', 'GET'], '/api/auth/*', c => auth.handler(c.req.raw))

app.use('/trpc/*', rateLimit({ windowMs: 60_000, limit: env.TRPC_RATE_LIMIT }))
app.use('/trpc/*', trpcServer({ router: appRouter, createContext }))

// Access log first in the chain so rate-limit (429) / body-limit (413) rejections are logged too.
app.use('/api/v1/*', accessLog)
// Read-only demo: reject all ingest writes (logged by accessLog above).
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

app.use('/api/slack/*', accessLog)
// Read-only demo: the Slack OAuth callback writes the integration (bypassing tRPC), so block it here.
app.use('/api/slack/*', blockInDemo)
app.route('/api/slack', slackOAuth)

// Demo-only: establishes the shared read-only session cookie (no-op otherwise).
app.route('/api/demo', demoApp)

app.onError((err, c) => {
  logger.error({ err }, 'unhandled request error')
  Sentry.captureException(err)
  return c.json({ error: 'Internal Server Error' }, 500)
})

export { app }
