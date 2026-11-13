import type { RunRegression } from '../contracts/ingest'
import type { Counts, RunIncident, ShardProgress } from '../contracts/kinora'
import type { FlakyTest, PrCommentPolicy, PrContext } from './pr-comment'
import { postPrComment } from './pr-comment'
import { postPrStatus } from './pr-status'

// The PR comment and commit status, as every uploader (Playwright reporter, Vitest reporter, CLI)
// posts them after a run. Best-effort: failures are logged, never thrown.

export type PrCommentOption = boolean | { label?: string, policy?: PrCommentPolicy }
export type PrStatusOption = boolean | { label?: string }

export interface PrReportOptions {
  comment?: { label?: string, policy: PrCommentPolicy }
  status?: { label?: string }
}

// The status label defaults to the comment one, so matrix legs need it set once.
export function resolvePrReportOptions(comment: PrCommentOption | undefined, status: PrStatusOption | undefined): PrReportOptions {
  const commentLabel = typeof comment === 'object' ? comment.label : undefined
  return {
    ...(comment && { comment: { label: commentLabel, policy: (typeof comment === 'object' ? comment.policy : undefined) ?? 'always' } }),
    ...(status && { status: { label: (typeof status === 'object' ? status.label : undefined) ?? commentLabel } }),
  }
}

// The label telling matrix legs apart, also used to keep their shards in separate runs.
export function prLegLabel(opts: PrReportOptions): string | undefined {
  return opts.comment?.label ?? opts.status?.label
}

export interface PrReportRun {
  projectSlug: string
  projectName: string
  runUrl?: string
  ciRunUrl?: string
  counts: Counts
  regression?: RunRegression
  flaky?: FlakyTest[]
  shards?: ShardProgress & { runId: string }
  incident?: Pick<RunIncident, 'reason'>
  baseBranch?: string
}

export interface PrReportLog {
  info: (message: string) => void
  warn: (message: string) => void
}

export async function postToPr(
  ctx: PrContext,
  opts: PrReportOptions,
  run: PrReportRun,
  log: PrReportLog,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<void> {
  const shared = {
    projectSlug: run.projectSlug,
    runUrl: run.runUrl,
    counts: run.counts,
    regression: run.regression,
    ...(run.shards && { shards: run.shards }),
    ...(run.incident && { incident: run.incident }),
  }
  if (opts.comment) {
    try {
      const outcome = await postPrComment(ctx, {
        ...shared,
        projectName: run.projectName,
        label: opts.comment.label,
        ciRunUrl: run.ciRunUrl,
        flaky: run.flaky,
      }, opts.comment.policy, fetchImpl)
      if (outcome !== 'skipped')
        log.info(`PR comment ${outcome}`)
    }
    catch (err) {
      log.warn(`PR comment failed: ${err instanceof Error ? err.message : err}`)
    }
  }
  if (opts.status) {
    try {
      const outcome = await postPrStatus(ctx, { ...shared, label: opts.status.label, baseBranch: run.baseBranch }, fetchImpl)
      if (outcome !== 'skipped')
        log.info(`PR status ${outcome}`)
    }
    catch (err) {
      log.warn(`PR status failed: ${err instanceof Error ? err.message : err}`)
    }
  }
}
