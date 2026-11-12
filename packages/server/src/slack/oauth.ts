import { Buffer } from 'node:buffer'
import { createHmac, timingSafeEqual } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { getEntitlements } from '../billing/entitlements'
import { db } from '../db'
import { member, project, slackIntegration } from '../db/schemas/index'
import { auth } from '../lib/auth'
import { env, slackApp } from '../lib/env'
import { logger } from '../lib/logger'

const SCOPE = 'incoming-webhook'
const STATE_TTL_MS = 10 * 60 * 1000

interface StatePayload {
  projectId: string
  userId: string
  slug: string
}

// Same gate as adminProcedure: connecting Slack rebinds where alerts are delivered.
async function isOrgAdmin(userId: string, organizationId: string): Promise<boolean> {
  const row = await db.query.member.findFirst({
    where: and(eq(member.userId, userId), eq(member.organizationId, organizationId)),
    columns: { role: true },
  })
  return row?.role === 'owner' || row?.role === 'admin'
}

function callbackUrl(): string {
  return `${env.BASE_URL}/api/slack/callback`
}

function settingsRedirect(slug: string, status: 'connected' | 'error'): string {
  return `${env.WEB_ORIGIN}/projects/${encodeURIComponent(slug)}/settings?slack=${status}`
}

function sign(body: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(body).digest('base64url')
}

export function encodeState(data: StatePayload): string {
  const body = Buffer.from(JSON.stringify({ ...data, exp: Date.now() + STATE_TTL_MS })).toString('base64url')
  return `${body}.${sign(body)}`
}

export function decodeState(state: string): StatePayload | null {
  const [body, sig] = state.split('.')
  if (!body || !sig)
    return null
  const expected = sign(body)
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected)))
    return null
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString()) as StatePayload & { exp: number }
    if (typeof data.exp !== 'number' || data.exp < Date.now())
      return null
    return { projectId: data.projectId, userId: data.userId, slug: data.slug }
  }
  catch {
    return null
  }
}

// "Add to Slack" OAuth: browser-redirect flow (session-cookie authed), not tRPC.
export const slackOAuth = new Hono()

slackOAuth.get('/install', async (c) => {
  if (!slackApp)
    return c.json({ error: 'Slack OAuth not configured' }, 404)

  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (!session?.user)
    return c.json({ error: 'Unauthorized' }, 401)

  const orgId = session.session.activeOrganizationId
  if (!orgId)
    return c.json({ error: 'No active organization' }, 400)

  const slug = c.req.query('projectId')
  if (!slug)
    return c.json({ error: 'projectId is required' }, 400)

  const p = await db.query.project.findFirst({
    where: and(eq(project.slug, slug), eq(project.organizationId, orgId)),
    columns: { id: true },
  })
  if (!p)
    return c.json({ error: 'Project not found' }, 404)

  if (!await isOrgAdmin(session.user.id, orgId))
    return c.json({ error: 'Requires an admin role' }, 403)

  const entitlements = await getEntitlements(orgId)
  if (!entitlements.alerts)
    return c.redirect(settingsRedirect(slug, 'error'))

  const authorize = new URL('https://slack.com/oauth/v2/authorize')
  authorize.searchParams.set('client_id', slackApp.clientId)
  authorize.searchParams.set('scope', SCOPE)
  authorize.searchParams.set('redirect_uri', callbackUrl())
  authorize.searchParams.set('state', encodeState({ projectId: p.id, userId: session.user.id, slug }))
  return c.redirect(authorize.toString())
})

slackOAuth.get('/callback', async (c) => {
  if (!slackApp)
    return c.json({ error: 'Slack OAuth not configured' }, 404)

  const code = c.req.query('code')
  const state = c.req.query('state')
  if (!code || !state)
    return c.json({ error: 'Missing code or state' }, 400)

  const decoded = decodeState(state)
  if (!decoded)
    return c.json({ error: 'Invalid state' }, 400)

  // The browser carrying the callback must be the same session that started the flow.
  const session = await auth.api.getSession({ headers: c.req.raw.headers })
  if (session?.user?.id !== decoded.userId)
    return c.json({ error: 'Unauthorized' }, 401)

  // Re-check the role: it may have been revoked since the flow started.
  const owner = await db.query.project.findFirst({
    where: eq(project.id, decoded.projectId),
    columns: { organizationId: true },
  })
  if (!owner || !await isOrgAdmin(decoded.userId, owner.organizationId))
    return c.json({ error: 'Requires an admin role' }, 403)

  try {
    const res = await fetch('https://slack.com/api/oauth.v2.access', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: slackApp.clientId,
        client_secret: slackApp.clientSecret,
        redirect_uri: callbackUrl(),
      }),
    })
    const data = await res.json() as {
      ok: boolean
      team_name?: string
      incoming_webhook?: { url?: string, channel?: string }
    }
    if (!data.ok || !data.incoming_webhook?.url)
      throw new Error('slack oauth exchange returned no webhook')

    // Keep the user's existing policy/enabled on re-auth; only refresh the webhook target.
    const values = {
      webhookUrl: data.incoming_webhook.url,
      channel: data.incoming_webhook.channel ?? null,
      teamName: data.team_name ?? null,
    }
    await db
      .insert(slackIntegration)
      .values({ projectId: decoded.projectId, ...values })
      .onConflictDoUpdate({ target: slackIntegration.projectId, set: values })

    return c.redirect(settingsRedirect(decoded.slug, 'connected'))
  }
  catch (error) {
    logger.error({ err: error }, 'slack oauth callback failed')
    return c.redirect(settingsRedirect(decoded.slug, 'error'))
  }
})
