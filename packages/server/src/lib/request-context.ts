import type { RequestIdVariables } from 'hono/request-id'
import * as Sentry from '@sentry/node'
import { createMiddleware } from 'hono/factory'
import { logger } from './logger'
import { clientIp } from './rate-limit'

// Errors reported to Sentry carry the id their logs have. A scope of its own per request, so
// concurrent requests never share it, even when the HTTP instrumentation hasn't isolated them.
export const sentryScope = createMiddleware<{ Variables: RequestIdVariables }>((c, next) =>
  Sentry.withIsolationScope((scope) => {
    scope.setTag('requestId', c.get('requestId'))
    return next()
  }))

// Successful hits here are noise: probes, and the viewer's many Range reads of a trace.zip.
const quietOnSuccess = ['/healthcheck', '/artifacts/']

/** One line per request once the response is known; uncaught throws are also logged by app.onError. */
export const requestLogger = createMiddleware(async (c, next) => {
  const start = performance.now()
  await next()
  const { method, path } = c.req
  const status = c.res.status
  if (status < 400 && (method === 'OPTIONS' || quietOnSuccess.some(p => path.startsWith(p))))
    return
  const level = status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
  // The message repeats the key fields: log viewers search and display messages, not attributes.
  logger[level]({
    method,
    path,
    status,
    durationMs: Math.round(performance.now() - start),
    ip: clientIp(c),
  }, `${method} ${path} ${status}`)
})
