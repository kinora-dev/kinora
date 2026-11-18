import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { artifact, member, organization, project, subscription } from '../db/schemas/index'
import { pinnedKeysOfProjects } from '../reports/quarantine'
import { logger } from './logger'
import { storage } from './storage'

// Statuses where Polar still bills the subscription at the end of the period.
const BILLING_STATUSES = ['active', 'trialing', 'past_due']

// Deleting the Polar customer cancels its subscription on the spot, so the metered overage of the
// current period would never be invoiced. Owners must cancel first and delete once the period ends.
export async function hasBillingSubscription(userId: string): Promise<boolean> {
  const [row] = await db
    .select({ tier: subscription.tier })
    .from(subscription)
    .innerJoin(member, eq(member.organizationId, subscription.organizationId))
    .where(and(eq(member.userId, userId), eq(member.role, 'owner'), inArray(subscription.status, BILLING_STATUSES)))
  return row != null && row.tier !== 'free'
}

// Deleting the user cascades member/session/account but NOT the orgs they own (no userId FK on
// organization), and storage blobs are never covered by FK cascade. Drop both here before delete.
export async function purgeUserOwnedData(userId: string): Promise<void> {
  const owned = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.role, 'owner')))
  const orgIds = owned.map(o => o.organizationId)
  if (orgIds.length === 0)
    return

  const projects = await db.select({ id: project.id }).from(project).where(inArray(project.organizationId, orgIds))
  const projectIds = projects.map(p => p.id)
  if (projectIds.length > 0) {
    const blobs = await db.select({ key: artifact.storageKey }).from(artifact).where(inArray(artifact.projectId, projectIds))
    const keys = new Set([...blobs.map(b => b.key), ...await pinnedKeysOfProjects(projectIds)])
    for (const key of keys) {
      try {
        await storage.delete(key)
      }
      catch (error) {
        logger.error({ error, key }, 'account purge: blob delete failed')
      }
    }
  }

  // Cascades project -> run/test/artifact + subscription/member/invitation.
  await db.delete(organization).where(inArray(organization.id, orgIds))
}
