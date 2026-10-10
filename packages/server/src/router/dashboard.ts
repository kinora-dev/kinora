import type { Manifest, ProjectEntry, ProjectHistory, RunComparison, RunReport } from '@kinora/core'
import { randomUUID } from 'node:crypto'
import { compareRuns, SCHEMA_VERSION } from '@kinora/core'
import { TRPCError } from '@trpc/server'
import { and, desc, eq, gt, isNull, or } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { project, run, test, testQuarantine } from '../db/schemas/index'
import { findProject, loadProjectHistory, loadRun, loadRunReport, loadRunSummaries, loadTestAttachments, MAX_DASHBOARD_RUNS, toNormTest } from '../reports/queries'
import { orgProcedure, router } from '../trpc/index'

export { MAX_DASHBOARD_RUNS }

export async function ownedProject(organizationId: string, slug: string) {
  const p = await findProject(organizationId, slug)
  if (!p)
    throw new TRPCError({ code: 'NOT_FOUND', message: 'Project not found' })
  return p
}

const quarantineInput = z.object({
  projectId: z.string().min(1),
  testKey: z.string().min(1),
})

function activeQuarantineWhere(projectId: string) {
  return and(
    eq(testQuarantine.projectId, projectId),
    or(isNull(testQuarantine.expiresAt), gt(testQuarantine.expiresAt, new Date())),
  )
}

export const dashboardRouter = router({
  manifest: orgProcedure.query(async ({ ctx }): Promise<Manifest> => {
    const projects = await db.query.project.findMany({
      where: eq(project.organizationId, ctx.organizationId),
      orderBy: desc(project.updatedAt),
    })
    // Per-project queries run concurrently (not a sequential N+1) and each is capped so one
    // long-lived project can't load its entire run history into memory.
    const entries: ProjectEntry[] = await Promise.all(projects.map(async (p) => {
      return { id: p.slug, name: p.name, description: p.description ?? undefined, runs: await loadRunSummaries(p) }
    }))
    return { schemaVersion: SCHEMA_VERSION, generatedAt: new Date().toISOString(), projects: entries }
  }),

  run: orgProcedure
    .input(z.object({ projectId: z.string().min(1), runId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<RunReport> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      const r = await loadRun(p.id, input.runId)
      if (!r)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' })
      return loadRunReport(p, r)
    }),

  projectHistory: orgProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<ProjectHistory> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      return loadProjectHistory(p)
    }),

  testAttachments: orgProcedure
    .input(z.object({ projectId: z.string().min(1), runId: z.string().min(1), testKey: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      const attachments = await loadTestAttachments(p, input.runId, input.testKey)
      if (!attachments)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Test not found in this run' })
      return attachments
    }),

  quarantines: orgProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      const rows = await db.query.testQuarantine.findMany({
        where: activeQuarantineWhere(p.id),
        orderBy: desc(testQuarantine.createdAt),
      })
      return rows.map(q => ({
        testKey: q.testKey,
        reason: q.reason ?? undefined,
        expiresAt: q.expiresAt?.toISOString(),
        createdAt: q.createdAt.toISOString(),
        updatedAt: q.updatedAt.toISOString(),
      }))
    }),

  quarantine: orgProcedure
    .input(quarantineInput.extend({
      reason: z.string().trim().max(500).optional(),
      expiresAt: z.string().datetime().optional().nullable(),
    }))
    .mutation(async ({ ctx, input }) => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      const now = new Date()
      const [row] = await db.insert(testQuarantine).values({
        id: randomUUID(),
        projectId: p.id,
        testKey: input.testKey,
        reason: input.reason || null,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        createdByUserId: ctx.user.id,
        updatedByUserId: ctx.user.id,
        createdAt: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: [testQuarantine.projectId, testQuarantine.testKey],
        set: {
          reason: input.reason || null,
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          updatedByUserId: ctx.user.id,
          updatedAt: now,
        },
      }).returning()
      return {
        testKey: row.testKey,
        reason: row.reason ?? undefined,
        expiresAt: row.expiresAt?.toISOString(),
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      }
    }),

  unquarantine: orgProcedure
    .input(quarantineInput)
    .mutation(async ({ ctx, input }) => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      await db.delete(testQuarantine).where(and(eq(testQuarantine.projectId, p.id), eq(testQuarantine.testKey, input.testKey)))
      return { ok: true }
    }),

  compareRuns: orgProcedure
    .input(z.object({ projectId: z.string().min(1), baseRunId: z.string().min(1), headRunId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<RunComparison> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      const [base, head] = await Promise.all([
        db.query.run.findFirst({ where: and(eq(run.id, input.baseRunId), eq(run.projectId, p.id)) }),
        db.query.run.findFirst({ where: and(eq(run.id, input.headRunId), eq(run.projectId, p.id)) }),
      ])
      if (!base || !head)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' })

      const [baseTests, headTests] = await Promise.all([
        db.query.test.findMany({ where: eq(test.runId, base.id) }),
        db.query.test.findMany({ where: eq(test.runId, head.id) }),
      ])

      return {
        base: { runId: base.id, startedAt: base.startedAt.toISOString(), counts: base.counts, git: base.git ?? undefined },
        head: { runId: head.id, startedAt: head.startedAt.toISOString(), counts: head.counts, git: head.git ?? undefined },
        tests: compareRuns(baseTests.map(t => toNormTest(t)), headTests.map(t => toNormTest(t))),
      }
    }),
})
