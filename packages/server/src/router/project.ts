import { eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { artifact, project } from '../db/schemas/index'
import { logger } from '../lib/logger'
import { storage } from '../lib/storage'
import { pinnedKeysOfProjects } from '../reports/quarantine'
import { adminProcedure, router } from '../trpc/index'
import { ownedProject } from './dashboard'

export const projectRouter = router({
  codeowners: adminProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      return {
        source: p.codeownersSource,
        text: p.codeownersText ?? '',
        syncedAt: p.codeownersSyncedAt?.toISOString(),
      }
    }),

  updateCodeowners: adminProcedure
    .input(z.object({ projectId: z.string(), text: z.string().max(200_000) }))
    .mutation(async ({ ctx, input }) => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      await db.update(project).set({
        codeownersSource: 'manual',
        codeownersText: input.text.trim() || null,
        codeownersSyncedAt: null,
      }).where(eq(project.id, p.id))
      return { ok: true }
    }),

  rename: adminProcedure
    .input(z.object({ projectId: z.string(), name: z.string().trim().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      await db.update(project).set({ name: input.name }).where(eq(project.id, p.id))
      return { ok: true }
    }),

  updateDescription: adminProcedure
    .input(z.object({ projectId: z.string(), description: z.string().max(2000) }))
    .mutation(async ({ ctx, input }) => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      await db.update(project).set({ description: input.description }).where(eq(project.id, p.id))
      return { ok: true }
    }),

  delete: adminProcedure
    .input(z.object({ projectId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const p = await ownedProject(ctx.organizationId, input.projectId)

      // Blobs first; the row delete cascades runs/tests/artifacts.
      const blobs = await db.select({ key: artifact.storageKey }).from(artifact).where(eq(artifact.projectId, p.id))
      const keys = new Set([...blobs.map(b => b.key), ...await pinnedKeysOfProjects([p.id])])
      for (const key of keys) {
        try {
          await storage.delete(key)
        }
        catch (error) {
          logger.error({ error, key }, 'project delete: blob delete failed')
        }
      }

      await db.delete(project).where(eq(project.id, p.id))
      return { ok: true }
    }),
})
