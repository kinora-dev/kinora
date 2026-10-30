import { and, eq, sql } from 'drizzle-orm'
import { db } from '../db'
import { member, user } from '../db/schemas/index'

// Workspace a new session opens on: the last one used if still a member, else the owned one, else any.
export async function defaultOrganizationId(userId: string): Promise<string | null> {
  const [u, memberships] = await Promise.all([
    db.query.user.findFirst({ where: eq(user.id, userId), columns: { lastActiveOrganizationId: true } }),
    db.query.member.findMany({ where: eq(member.userId, userId), columns: { organizationId: true, role: true } }),
  ])
  const last = u?.lastActiveOrganizationId
  if (last && memberships.some(m => m.organizationId === last))
    return last
  return (memberships.find(m => m.role === 'owner') ?? memberships[0])?.organizationId ?? null
}

export async function rememberActiveOrganization(userId: string, organizationId: string): Promise<void> {
  await db.update(user)
    .set({ lastActiveOrganizationId: organizationId })
    // Session refreshes also fire the update hook; skip the write when nothing changed.
    .where(and(eq(user.id, userId), sql`${user.lastActiveOrganizationId} is distinct from ${organizationId}`))
}
