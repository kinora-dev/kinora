import type { ClusterTriage, DashboardOverview, OverviewProject, ProjectHistory, ProjectListing, ProjectRunsPage, RunComparison, RunIncident, RunReport, RunSummary } from '@kinora/core'
import type { ProjectAnalytics } from '../reports/analytics'
import type { InboxCluster, TestHistoryPage } from '../reports/queries'
import { randomUUID } from 'node:crypto'
import { clusterStatusSchema, compareRuns } from '@kinora/core'
import { TRPCError } from '@trpc/server'
import { and, desc, eq } from 'drizzle-orm'
import { z } from 'zod'
import { db } from '../db'
import { run, test, testQuarantine } from '../db/schemas/index'
import { storage } from '../lib/storage'
import { ANALYTICS_RANGES, isTimeZone, loadProjectAnalytics } from '../reports/analytics'
import { saveTriage } from '../reports/clusters'
import { activeQuarantineWhere, deleteUnpinnedOrphan, pinLatestFailureTrace } from '../reports/quarantine'
import { findProject, incidentState, loadFailureInbox, loadOverview, loadPreviousRunId, loadProjectHistory, loadProjectListings, loadProjectSummary, loadRun, loadRunPage, loadRunReport, loadTestAttachments, loadTestHistoryPage, searchRuns, searchTests, toNormTest } from '../reports/queries'
import { slowerTests } from '../reports/regression'
import { orgProcedure, router } from '../trpc/index'

// What a page needs to name the project it shows, without loading the project's runs.
interface ProjectRef { id: string, name: string }

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

export const dashboardRouter = router({
  projects: orgProcedure.query(({ ctx }): Promise<ProjectListing[]> => loadProjectListings(ctx.organizationId)),

  overview: orgProcedure
    .input(z.object({
      branch: z.string().min(1).max(255).optional(),
      tag: z.string().min(1).max(255).optional(),
    }).default({}))
    .query(({ ctx, input }): Promise<DashboardOverview> => loadOverview(ctx.organizationId, input)),

  projectSummary: orgProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<OverviewProject> => loadProjectSummary(await ownedProject(ctx.organizationId, input.projectId))),

  projectRuns: orgProcedure
    .input(z.object({
      projectId: z.string().min(1),
      before: z.string().min(1).max(255).optional(),
      after: z.string().min(1).max(255).optional(),
    }).refine(i => !(i.before && i.after), 'Pass before or after, not both'))
    .query(async ({ ctx, input }): Promise<ProjectRunsPage> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      return loadRunPage(p, input)
    }),

  project: orgProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<ProjectRef & { description?: string }> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      return { id: p.slug, name: p.name, description: p.description ?? undefined }
    }),

  run: orgProcedure
    .input(z.object({ projectId: z.string().min(1), runId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<RunReport & { project: ProjectRef, previousRunId?: string }> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      const r = await loadRun(p.id, input.runId)
      if (!r)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' })
      const [report, previousRunId] = await Promise.all([loadRunReport(p, r), loadPreviousRunId(p, r.id)])
      return { ...report, project: { id: p.slug, name: p.name }, previousRunId }
    }),

  projectHistory: orgProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<ProjectHistory> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      return loadProjectHistory(p)
    }),

  // The Components page: only the tests that mount stories.
  componentHistory: orgProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<ProjectHistory> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      return loadProjectHistory(p, { componentsOnly: true })
    }),

  // The test history page: one test with every point (the project history trims them), and the
  // clusters it shares with other tests.
  testHistory: orgProcedure
    .input(z.object({ projectId: z.string().min(1), testKey: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<TestHistoryPage> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      return loadTestHistoryPage(p, input.testKey)
    }),

  analytics: orgProcedure
    .input(z.object({
      projectId: z.string().min(1),
      days: z.literal(ANALYTICS_RANGES).default(30),
      branch: z.string().min(1).max(255).optional(),
      timeZone: z.string().max(64).refine(isTimeZone, 'Invalid time zone').default('UTC'),
    }))
    .query(async ({ ctx, input }): Promise<ProjectAnalytics & { project: { id: string, name: string } }> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      const analytics = await loadProjectAnalytics(p.id, input.days, input.branch, input.timeZone)
      return { ...analytics, project: { id: p.slug, name: p.name } }
    }),

  // Command palette: tests across every project of the workspace. An unknown `projectId` only
  // affects ordering, so there is no ownership to check.
  searchTests: orgProcedure
    .input(z.object({ q: z.string().trim().min(2).max(200), projectId: z.string().min(1).optional() }))
    .query(({ ctx, input }) => searchTests(ctx.organizationId, input.q, input.projectId)),

  searchRuns: orgProcedure
    .input(z.object({ q: z.string().trim().min(2).max(200) }))
    .query(({ ctx, input }) => searchRuns(ctx.organizationId, input.q)),

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
      return Promise.all(rows.map(async q => ({
        testKey: q.testKey,
        reason: q.reason ?? undefined,
        expiresAt: q.expiresAt?.toISOString(),
        createdAt: q.createdAt.toISOString(),
        updatedAt: q.updatedAt.toISOString(),
        pinnedTrace: q.pinnedTraceKey && q.pinnedTrace ? { ...q.pinnedTrace, url: await storage.url(q.pinnedTraceKey) } : undefined,
      })))
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
      if (!row.pinnedTraceKey)
        await pinLatestFailureTrace(p.id, row.testKey)
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
      const [removed] = await db.delete(testQuarantine)
        .where(and(eq(testQuarantine.projectId, p.id), eq(testQuarantine.testKey, input.testKey)))
        .returning({ pinnedTraceKey: testQuarantine.pinnedTraceKey })
      if (removed?.pinnedTraceKey)
        await deleteUnpinnedOrphan(removed.pinnedTraceKey)
      return { ok: true }
    }),

  // Mark a run the rules missed as an environment incident, or clear a flag on real failures. The
  // decision sticks: a later shard or upload never re-judges the run.
  setRunIncident: orgProcedure
    .input(z.object({
      projectId: z.string().min(1),
      runId: z.string().min(1),
      flagged: z.boolean(),
      reason: z.string().trim().max(500).optional(),
    }))
    .mutation(async ({ ctx, input }): Promise<Pick<RunSummary, 'incident' | 'incidentDecision'>> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      const r = await loadRun(p.id, input.runId)
      if (!r)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' })
      // Marking an already flagged run keeps what the rules found.
      const incident: RunIncident | null = !input.flagged
        ? null
        : r.incident ?? { rule: 'manual', reason: input.reason || 'Marked as an environment incident.' }
      const [row] = await db.update(run).set({
        incident,
        incidentDecision: { flagged: input.flagged, by: ctx.user.name || ctx.user.email, at: new Date().toISOString() },
      }).where(eq(run.id, r.id)).returning()
      return incidentState(row)
    }),

  // Open failure clusters across the workspace, for the overview's inbox.
  failureInbox: orgProcedure.query(({ ctx }): Promise<InboxCluster[]> => loadFailureInbox(ctx.organizationId)),

  // Any field left out is kept; null clears it. Resolving or ignoring lifts a snooze.
  triageCluster: orgProcedure
    .input(z.object({
      projectId: z.string().min(1),
      fingerprint: z.string().min(1).max(64),
      status: clusterStatusSchema.optional(),
      assigneeId: z.string().min(1).nullable().optional(),
      issueUrl: z.url({ protocol: /^https?$/ }).max(2000).nullable().optional(),
      note: z.string().trim().max(2000).nullable().optional(),
      snooze: z.union([z.object({ until: z.iso.datetime() }), z.literal('recur'), z.null()]).optional(),
    }))
    .mutation(async ({ ctx, input }): Promise<ClusterTriage> => {
      const { projectId, fingerprint, ...change } = input
      const p = await ownedProject(ctx.organizationId, projectId)
      return saveTriage(p, fingerprint, change, ctx.user.id)
    }),

  compareRuns: orgProcedure
    .input(z.object({ projectId: z.string().min(1), baseRunId: z.string().min(1), headRunId: z.string().min(1) }))
    .query(async ({ ctx, input }): Promise<RunComparison & { project: ProjectRef }> => {
      const p = await ownedProject(ctx.organizationId, input.projectId)
      const [base, head] = await Promise.all([
        db.query.run.findFirst({ where: and(eq(run.id, input.baseRunId), eq(run.projectId, p.id)) }),
        db.query.run.findFirst({ where: and(eq(run.id, input.headRunId), eq(run.projectId, p.id)) }),
      ])
      if (!base || !head)
        throw new TRPCError({ code: 'NOT_FOUND', message: 'Run not found' })

      const [baseTests, headTests] = await Promise.all([
        db.query.test.findMany({ where: eq(test.runId, base.id) }).then(rows => rows.map(t => toNormTest(t))),
        db.query.test.findMany({ where: eq(test.runId, head.id) }).then(rows => rows.map(t => toNormTest(t))),
      ])
      // Usual times on the base's branch, up to and including the base run: the reference side.
      const slower = await slowerTests(p.id, headTests, new Date(base.startedAt.getTime() + 1), base.git?.branch)

      return {
        project: { id: p.slug, name: p.name },
        base: { runId: base.id, startedAt: base.startedAt.toISOString(), counts: base.counts, git: base.git ?? undefined },
        head: { runId: head.id, startedAt: head.startedAt.toISOString(), counts: head.counts, git: head.git ?? undefined },
        tests: compareRuns(baseTests, headTests),
        slower,
      }
    }),
})
