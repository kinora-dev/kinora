import type { NormTest, ProjectEntry, ProjectHistory, RunReport, RunSummary } from '@kinora/core'
import type { CodeownersRule } from '../lib/codeowners'
import { buildFailureClusters, buildTestHistories, SCHEMA_VERSION } from '@kinora/core'
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { db } from '../db'
import { artifact, project, run, test } from '../db/schemas/index'
import { matchCodeowners, parseCodeowners } from '../lib/codeowners'
import { storage } from '../lib/storage'

type ProjectRow = typeof project.$inferSelect
type RunRow = typeof run.$inferSelect
type TestRow = typeof test.$inferSelect

// Most-recent runs per project the dashboard loads. Memory bound until the UI gets pagination;
// projects with more runs show this window in trends/history.
export const MAX_DASHBOARD_RUNS = 500

export function runSummary(slug: string, r: RunRow): RunSummary {
  return {
    runId: r.id,
    projectId: slug,
    startedAt: r.startedAt.toISOString(),
    duration: r.duration,
    counts: r.counts,
    playwrightVersion: r.playwrightVersion ?? undefined,
    git: r.git ?? undefined,
    ci: r.ci ?? undefined,
    shards: r.shards ?? undefined,
    reportPath: `reports/${slug}/${r.id}.json`,
    countsByTag: r.countsByTag,
  }
}

// Attachment names repeat within a test (two toHaveScreenshot assertions both attach "actual"),
// so urls are queued per name and handed out in upload order.
export function toNormTest(t: TestRow, urls?: Map<string, string[]>, codeowners?: CodeownersRule[]): NormTest {
  const seen = new Map<string, number>()
  return {
    testKey: t.testKey,
    title: t.title,
    titlePath: t.titlePath,
    file: t.file,
    line: t.line,
    column: t.column,
    projectName: t.projectName,
    status: t.status,
    ok: t.ok,
    duration: t.duration,
    retries: t.retries,
    tags: t.tags,
    annotations: t.annotations,
    errors: t.errors,
    attachments: t.attachments.map((a) => {
      const index = seen.get(a.name) ?? 0
      seen.set(a.name, index + 1)
      return { ...a, url: urls?.get(a.name)?.[index] ?? a.url }
    }),
    codeOwners: codeowners?.length ? matchCodeowners(codeowners, t.file) : undefined,
  }
}

export function runReport(slug: string, r: RunRow, tests: TestRow[], urlsByTest?: Map<string, Map<string, string[]>>, codeowners?: CodeownersRule[]): RunReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId: r.id,
    projectId: slug,
    startedAt: r.startedAt.toISOString(),
    duration: r.duration,
    counts: r.counts,
    meta: { playwrightVersion: r.playwrightVersion ?? undefined, git: r.git ?? undefined, ci: r.ci ?? undefined, shards: r.shards ?? undefined },
    tests: tests.map(t => toNormTest(t, urlsByTest?.get(t.id), codeowners)),
  }
}

export function findProject(organizationId: string, slug: string): Promise<ProjectRow | undefined> {
  return db.query.project.findFirst({
    where: and(eq(project.slug, slug), eq(project.organizationId, organizationId)),
  })
}

export function listProjects(organizationId: string): Promise<ProjectRow[]> {
  return db.query.project.findMany({
    where: eq(project.organizationId, organizationId),
    orderBy: desc(project.updatedAt),
  })
}

export function loadRun(projectId: string, runId: string): Promise<RunRow | undefined> {
  return db.query.run.findFirst({ where: and(eq(run.id, runId), eq(run.projectId, projectId)) })
}

export function loadLatestRun(projectId: string): Promise<RunRow | undefined> {
  return db.query.run.findFirst({ where: eq(run.projectId, projectId), orderBy: desc(run.startedAt) })
}

export function loadRunSummaries(p: ProjectRow, limit = MAX_DASHBOARD_RUNS): Promise<RunSummary[]> {
  return db.query.run
    .findMany({ where: eq(run.projectId, p.id), orderBy: desc(run.startedAt), limit })
    .then(runs => runs.map(r => runSummary(p.slug, r)))
}

// Artifact URLs are resolved (signed local / presigned S3) at read time, not stored.
export async function loadRunReport(p: ProjectRow, r: RunRow): Promise<RunReport> {
  const tests = await db.query.test.findMany({ where: eq(test.runId, r.id), orderBy: asc(test.file) })
  const arts = await db.query.artifact.findMany({ where: eq(artifact.runId, r.id), orderBy: asc(artifact.createdAt) })

  const urlsByTest = new Map<string, Map<string, string[]>>()
  for (const a of arts) {
    if (!a.testId)
      continue
    const m = urlsByTest.get(a.testId) ?? new Map<string, string[]>()
    m.set(a.name, [...(m.get(a.name) ?? []), await storage.url(a.storageKey)])
    urlsByTest.set(a.testId, m)
  }

  return runReport(p.slug, r, tests, urlsByTest, parseCodeowners(p.codeownersText))
}

// One test's attachments in one run, with signed urls: what the test history page loads when
// someone opens a failed screenshot assertion. undefined = no such test in that run of the project.
export async function loadTestAttachments(p: ProjectRow, runId: string, testKey: string): Promise<NormTest['attachments'] | undefined> {
  const t = await db.query.test.findFirst({ where: and(eq(test.projectId, p.id), eq(test.runId, runId), eq(test.testKey, testKey)) })
  if (!t)
    return undefined
  const arts = await db.query.artifact.findMany({ where: eq(artifact.testId, t.id), orderBy: asc(artifact.createdAt) })
  const urls = new Map<string, string[]>()
  for (const a of arts)
    urls.set(a.name, [...(urls.get(a.name) ?? []), await storage.url(a.storageKey)])
  return toNormTest(t, urls).attachments
}

// Newest runs only, then just those runs' tests, to bound memory on long-lived projects.
export async function loadProjectHistory(p: ProjectRow): Promise<ProjectHistory> {
  const runs = await db.query.run.findMany({ where: eq(run.projectId, p.id), orderBy: desc(run.startedAt), limit: MAX_DASHBOARD_RUNS })
  const runIds = runs.map(r => r.id)
  const windowTests = runIds.length ? await db.query.test.findMany({ where: inArray(test.runId, runIds) }) : []

  const byRun = new Map<string, TestRow[]>()
  for (const t of windowTests) {
    const arr = byRun.get(t.runId) ?? []
    arr.push(t)
    byRun.set(t.runId, arr)
  }

  const codeowners = parseCodeowners(p.codeownersText)
  const reports = runs.map(r => runReport(p.slug, r, byRun.get(r.id) ?? [], undefined, codeowners))
  const entry: ProjectEntry = { id: p.slug, name: p.name, runs: runs.map(r => runSummary(p.slug, r)) }
  return { project: entry, histories: buildTestHistories(reports), clusters: buildFailureClusters(reports) }
}
