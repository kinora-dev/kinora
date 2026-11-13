import type { AttachmentKind, CiMeta, Counts, GitMeta, IngestRun, IngestRunResult, NormTest, PrCommentOption, PrReportOptions, PrStatusOption } from '@kinora/core'
import type { Reporter, TestModule, Vitest } from 'vitest/node'
import type { IncludeTests } from './convert'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { artifactsToUpload, createIngestClient, DEFAULT_KINORA_URL, DEFAULT_UPLOAD_ATTACHMENTS, describeRetry, detectCiEnv, flakyTestsOf, IngestError, postToPr, prLegLabel, resolvePrContext, resolvePrReportOptions, resolveShardGroup, uploadArtifacts } from '@kinora/core'
import { toNormTests } from './convert'

export interface KinoraVitestReporterOptions {
  /** kinora server base URL. Defaults to env KINORA_URL, then the hosted cloud. Set for self-host. */
  url?: string
  /** Project API token. Defaults to env KINORA_TOKEN (keep it out of the config file). */
  token?: string
  /** Target project. `name` defaults to `slug`. */
  project: { slug: string, name?: string }
  git?: GitMeta
  ci?: CiMeta
  /** Which attachment kinds to upload. Defaults to `['trace', 'snapshot']`. */
  uploadAttachments?: AttachmentKind[]
  /**
   * Which tests to upload. `browser` (default) keeps the tests of projects running in a browser
   * (browser mode, Storybook) and leaves Node unit tests out. `all` uploads everything; mind the
   * plan's monthly result quota with large unit suites.
   */
  include?: IncludeTests
  /**
   * Sharded runs (`--shard`): the uploads of every shard of a CI run are assembled into a single
   * kinora run. Shards are grouped by this key, defaulting to env KINORA_GROUP_KEY, then the CI run
   * (GITHUB_RUN_ID / CI_PIPELINE_ID). Set it when a matrix runs the sharded suite once per leg, to
   * tell the legs apart. `false` uploads each shard as its own run.
   */
  groupKey?: string | false
  /**
   * Post/update a summary comment on the GitHub PR (uses the job's GITHUB_TOKEN; needs
   * `permissions: pull-requests: write`) or the GitLab MR (needs a GITLAB_TOKEN CI variable with
   * the `api` scope). `label` distinguishes matrix legs sharing one PR.
   */
  prComment?: PrCommentOption
  /**
   * Set a `kinora / <project>` commit status on the GitHub PR (needs `permissions: statuses: write`)
   * or the GitLab MR pipeline (GITLAB_TOKEN with the Developer role): red only for tests newly
   * failing vs the base branch. `label` distinguishes matrix legs, defaulting to the `prComment` one.
   */
  prStatus?: PrStatusOption
}

function countsOf(tests: NormTest[]): Counts {
  const counts: Counts = { total: tests.length, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  for (const t of tests)
    counts[t.status]++
  return counts
}

export default class KinoraVitestReporter implements Reporter {
  private startedAt = new Date()
  private shard: { current: number, total: number } | undefined

  constructor(private readonly options: KinoraVitestReporterOptions) {}

  onInit(vitest: Vitest): void {
    this.startedAt = new Date()
    const shard = vitest.config.shard
    this.shard = shard ? { current: shard.index, total: shard.count } : undefined
    // Test locations (file:line in the dashboard) are only collected when asked for. Turn them on
    // for every project, before any test is collected.
    vitest.config.includeTaskLocation = true
    for (const project of vitest.projects)
      project.config.includeTaskLocation = true
  }

  onTestRunStart(): void {
    this.startedAt = new Date()
  }

  async onTestRunEnd(modules: ReadonlyArray<TestModule>): Promise<void> {
    const url = this.options.url ?? process.env.KINORA_URL ?? DEFAULT_KINORA_URL
    const token = this.options.token ?? process.env.KINORA_TOKEN
    if (!token) {
      console.warn('[kinora] skipping upload: missing token (set KINORA_TOKEN)')
      return
    }

    const { tests, skippedNodeTests } = toNormTests(modules, this.options.include)
    const prOptions = resolvePrReportOptions(this.options.prComment, this.options.prStatus)
    const group = this.shard && this.options.groupKey !== false
      ? resolveShardGroup(process.env, { groupKey: this.options.groupKey, leg: prLegLabel(prOptions) })
      : undefined
    if (!tests.length) {
      // A shard that ran no test still fills its slot, or the run would wait for it and close as incomplete.
      if (!group) {
        console.warn(skippedNodeTests
          ? `[kinora] nothing uploaded: no browser tests in this run (${skippedNodeTests} Node tests left out). Set include: 'all' to upload Node tests too.`
          : '[kinora] nothing uploaded: no tests ran')
        return
      }
      console.warn('[kinora] no tests to upload in this shard: filling its slot so the run can complete')
    }
    const detected = detectCiEnv(process.env)
    const payload: IngestRun = {
      project: { slug: this.options.project.slug, name: this.options.project.name ?? this.options.project.slug },
      run: {
        startedAt: this.startedAt.toISOString(),
        duration: Date.now() - this.startedAt.getTime(),
        counts: countsOf(tests),
        git: this.options.git ?? detected.git,
        ci: this.options.ci ?? detected.ci,
        ...(this.shard && group && { ...group, shard: this.shard }),
      },
      tests,
    }

    // Upload never fails the test run.
    try {
      const client = createIngestClient({ baseUrl: url, token, regression: !!(prOptions.comment || prOptions.status), onRetry: info => console.warn(`[kinora] ${describeRetry(info)}`) })
      const res = await client.uploadRun(payload)
      const artifacts = await uploadArtifacts(client, res.runId, artifactsToUpload(tests, this.options.uploadAttachments ?? DEFAULT_UPLOAD_ATTACHMENTS), {
        read: readFile,
        onFailed: (a, err) => console.warn(`[kinora] ${a.name} upload failed for ${a.testKey}:`, err instanceof Error ? err.message : err),
      })
      // eslint-disable-next-line no-console -- a reporter's job is to report
      console.log(`[kinora] uploaded ${res.tests} tests + ${artifacts} artifacts (run ${res.runId}${res.shardProgress ? `, ${res.shardProgress.landed} of ${res.shardProgress.total} shards` : ''})`)
      if (res.incident)
        console.warn(`[kinora] environment incident, not counted: ${res.incident.reason}`)
      await this.maybePostToPr(prOptions, payload, res)
    }
    catch (err) {
      if (err instanceof IngestError && err.status === 402)
        console.warn(`[kinora] ${err.message}`)
      else
        console.error('[kinora] upload failed:', err instanceof Error ? err.message : err)
    }
  }

  // Every shard of a grouped run updates the PR with the shards landed so far. A shard uploaded on
  // its own is a partial run, and a server that predates grouping sends no progress: neither posts.
  private async maybePostToPr(opts: PrReportOptions, payload: IngestRun, res: IngestRunResult): Promise<void> {
    if (!opts.comment && !opts.status)
      return
    if (this.shard && !res.shardProgress)
      return
    const ctx = resolvePrContext(process.env, (p) => {
      try {
        return readFileSync(p, 'utf8')
      }
      catch {
        return undefined
      }
    })
    if (!ctx)
      return
    await postToPr(ctx, opts, {
      projectSlug: payload.project.slug,
      projectName: payload.project.name,
      runUrl: res.runUrl,
      ciRunUrl: payload.run.ci?.runUrl,
      counts: res.counts ?? payload.run.counts,
      regression: res.regression,
      flaky: res.flaky ?? flakyTestsOf(payload.tests),
      baseBranch: payload.run.git?.baseBranch,
      ...(res.shardProgress && { shards: { runId: res.runId, ...res.shardProgress } }),
      ...(res.incident && { incident: res.incident }),
    }, { info: m => console.warn(`[kinora] ${m}`), warn: m => console.warn(`[kinora] ${m}`) })
  }
}
