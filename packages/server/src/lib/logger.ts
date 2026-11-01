import type {} from 'hono/request-id'
import { tryGetContext } from 'hono/context-storage'
import pino from 'pino'
import { env } from './env'

declare module 'hono' {
  interface ContextVariableMap {
    /** Session user of a dashboard request, set by the tRPC context. */
    userId: string
    /** Organization the request acts on: the API key's owner, or the session's active org. */
    orgId: string
  }
}

/** Request fields every log line carries, whoever logs it (Better Auth and services included). */
export function logContext(): Record<string, string> {
  const c = tryGetContext()
  if (!c)
    return {}
  const fields: Record<string, string> = { requestId: c.get('requestId') }
  const userId = c.get('userId')
  const orgId = c.get('orgId')
  if (userId)
    fields.userId = userId
  if (orgId)
    fields.orgId = orgId
  return fields
}

export const logger = pino({
  level: env.LOG_LEVEL,
  mixin: logContext,
  redact: [
    'req.headers.authorization',
    'req.headers.cookie',
    '*.password',
    '*.token',
  ],
  // JSON in production so log collectors keep every field; pretty output is for local dev only.
  transport: env.NODE_ENV === 'production' ? undefined : { target: 'pino-pretty' },
})
