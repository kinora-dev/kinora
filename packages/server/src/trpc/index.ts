import type { Context } from './context'
import * as Sentry from '@sentry/node'
import { initTRPC, TRPCError } from '@trpc/server'
import { and, eq } from 'drizzle-orm'
import { db } from '../db'
import { member } from '../db/schemas/index'
import { cloud, demo, env } from '../lib/env'
import { logger } from '../lib/logger'

export const t = initTRPC.context<Context>().create({
  // An unexpected error's message can carry internals (a failed query's full SQL): production
  // clients get a generic one, the real one stays in the log and Sentry.
  errorFormatter: ({ shape, error }) =>
    env.NODE_ENV === 'production' && error.code === 'INTERNAL_SERVER_ERROR'
      ? { ...shape, message: 'Internal server error' }
      : shape,
})

const loggedProcedure = t.procedure.use(async (opts) => {
  // Public demo is browse-only: reject every mutation (one gate for all routers).
  if (demo && opts.type === 'mutation')
    throw new TRPCError({ code: 'FORBIDDEN', message: 'This is a read-only demo' })
  const start = Date.now()
  const result = await opts.next()
  const fields = { type: opts.type, procedure: opts.path, durationMs: Date.now() - start }
  // Debug on success: the request log already has the HTTP line, this one splits a batch per procedure.
  if (result.ok) {
    logger.debug(fields, `${opts.type} ${opts.path} OK`)
    return result
  }
  const { code, message, cause } = result.error
  const line = `${opts.type} ${opts.path} ${code}`
  // Expected TRPCErrors (auth, validation, not found) are client mistakes, not server failures.
  if (code === 'INTERNAL_SERVER_ERROR') {
    logger.error({ ...fields, code, err: cause ?? result.error }, line)
    Sentry.captureException(cause ?? result.error)
  }
  else {
    logger.warn({ ...fields, code, error: message }, line)
  }
  return result
})

export const router = t.router
export const publicProcedure = loggedProcedure

export const authProcedure = loggedProcedure.use(async (opts) => {
  if (!opts.ctx.user)
    throw new TRPCError({ code: 'UNAUTHORIZED' })
  return opts.next({ ctx: { user: opts.ctx.user } })
})

// Most dashboard data is scoped to the session's active organization.
export const orgProcedure = authProcedure.use(async (opts) => {
  if (!opts.ctx.organizationId)
    throw new TRPCError({ code: 'FORBIDDEN', message: 'No active organization' })
  return opts.next({ ctx: { organizationId: opts.ctx.organizationId } })
})

// Mutations that change org config (projects, alerts, tokens) need an admin/owner role.
export const adminProcedure = orgProcedure.use(async (opts) => {
  const row = await db.query.member.findFirst({
    where: and(eq(member.userId, opts.ctx.user.id), eq(member.organizationId, opts.ctx.organizationId)),
    columns: { role: true },
  })
  if (row?.role !== 'owner' && row?.role !== 'admin')
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires an admin role' })
  return opts.next()
})

// Cross-org operator analytics. Distinct from adminProcedure (org member role)
export const platformAdminProcedure = authProcedure.use(async (opts) => {
  if (!cloud)
    throw new TRPCError({ code: 'NOT_FOUND' })
  if (opts.ctx.user.role !== 'admin')
    throw new TRPCError({ code: 'FORBIDDEN', message: 'Requires platform admin' })
  return opts.next({ ctx: { user: opts.ctx.user } })
})
