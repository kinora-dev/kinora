import type { FetchCreateContextFnOptions } from '@trpc/server/adapters/fetch'
import type { AuthType } from '../lib/auth'
import { tryGetContext } from 'hono/context-storage'
import { resolveDemoOwner } from '../demo/owner'
import { defaultOrganizationId } from '../lib/active-org'
import { auth } from '../lib/auth'
import { demo } from '../lib/env'

export async function createContext({ req }: FetchCreateContextFnOptions) {
  const session = await auth.api.getSession({ headers: req.headers })
  const user = session?.user ?? null
  let organizationId = session?.session.activeOrganizationId ?? null

  // Self-heal sessions with no active org (e.g. predating the org plugin).
  if (user && !organizationId)
    organizationId = await defaultOrganizationId(user.id)

  if (!user && demo) {
    const d = await resolveDemoOwner()
    // db row is structurally the session user; cast to the auth user type for ctx consistency.
    if (d)
      return tagRequest({ user: d.user as unknown as AuthType['user'], organizationId: d.organizationId, req })
  }

  return tagRequest({ user, organizationId, req })
}

// Names the user and org on every log line of the request.
function tagRequest<T extends { user: { id: string } | null, organizationId: string | null }>(ctx: T): T {
  const c = tryGetContext()
  if (c && ctx.user)
    c.set('userId', ctx.user.id)
  if (c && ctx.organizationId)
    c.set('orgId', ctx.organizationId)
  return ctx
}

export type Context = Awaited<ReturnType<typeof createContext>>
