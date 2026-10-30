import type { AttachmentKind, CiMeta, Counts, GitMeta, IngestRun, IngestRunResult, NormTest } from '@kinora/core'
import type { FullConfig, FullResult, Reporter, Suite, TestCase } from '@playwright/test/reporter'
import type { Buffer } from 'node:buffer'
import { readFileSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { a11yFromScans, createIngestClient, DEFAULT_KINORA_URL, DEFAULT_UPLOAD_ATTACHMENTS, describeRetry, detectCiEnv, effectiveAttachments, flakyTestsOf, IngestError, isUploadableAttachment, makeTestKey, parseAxeScan, postPrComment, resolvePrContext, resolveShardGroup } from '@kinora/core'

export interface KinoraReporterOptions {
  /** kinora server base URL. Defaults to env KINORA_URL, then the hosted cloud. Set for self-host. */
  url?: string
  /** Project API token. Defaults to env KINORA_TOKEN (keep it out of the config file). */
  token?: string
  /** Target project. `name` defaults to `slug`. */
  project: { slug: string, name?: string }
  git?: GitMeta
  ci?: CiMeta
  /**
   * Post/update a summary comment on the GitHub PR (uses the job's GITHUB_TOKEN; needs
   * `permissions: pull-requests: write`) or the GitLab MR (needs a GITLAB_TOKEN CI variable with
   * the `api` scope). `label` distinguishes matrix legs sharing one PR.
   */
  prComment?: boolean | { label?: string, policy?: 'always' | 'on-failure' }
  /**
   * Which attachment kinds to upload. Defaults to `['trace', 'snapshot']` (`snapshot` = the images
   * of a failed screenshot assertion, shown as a comparison). Add `'video'` / `'screenshot'`
   * to host them on their own, which is what you want when `trace` is off (with tracing on,
   * Playwright already embeds them in the trace.zip).
   */
  uploadAttachments?: AttachmentKind[]
  /**
   * Sharded runs (`--shard`): the uploads of every shard of one CI run are assembled into a single
   * kinora run. Shards are grouped by this key, defaulting to env KINORA_GROUP_KEY, then the CI run
   * (GITHUB_RUN_ID / CI_PIPELINE_ID). `false` uploads each shard as its own run.
   */
  groupKey?: string | false
}

// Rebuild the json-report identity (file path + title path + project) from the
// reporter suite tree so testKey matches the CLI path. Suite titles: file path
// for `file` suites, describe title for `describe`, project name for `project`.
function identity(test: TestCase): { file: string, titlePath: string[], projectName: string } {
  let file = ''
  let projectName = ''
  const describes: string[] = []
  let suite: Suite | undefined = test.parent
  while (suite) {
    if (suite.type === 'file')
      file = suite.title
    else if (suite.type === 'project')
      projectName = suite.title
    else if (suite.type === 'describe' && suite.title)
      describes.unshift(suite.title)
    suite = suite.parent
  }
  return { file, titlePath: [file, ...describes, test.title], projectName }
}

// A JSON attachment past this size is not an axe scan worth parsing in the reporter.
const MAX_SCAN_BYTES = 20 * 1024 * 1024

// The axe scans a test attached as JSON (`testInfo.attach(name, { body: JSON.stringify(results),
// contentType: 'application/json' })`, or the same from a file).
function axeScans(attachments: { contentType: string, body?: Buffer, path?: string }[]): { violations: unknown[] }[] {
  return attachments.flatMap((a) => {
    if (!a.contentType.includes('json'))
      return []
    try {
      const text = a.body
        ? (a.body.length <= MAX_SCAN_BYTES ? a.body.toString('utf8') : undefined)
        : a.path && statSync(a.path).size <= MAX_SCAN_BYTES ? readFileSync(a.path, 'utf8') : undefined
      const scan = text ? parseAxeScan(text) : undefined
      return scan ? [scan] : []
    }
    catch {
      return [] // unreadable file: not worth failing the upload
    }
  })
}

function toNormTest(test: TestCase): NormTest {
  const { file, titlePath, projectName } = identity(test)
  const last = test.results.at(-1)
  const attachments = effectiveAttachments(test.results)
  const a11y = a11yFromScans(axeScans(attachments), test.ok())
  return {
    testKey: makeTestKey(file, titlePath, projectName),
    title: test.title,
    titlePath,
    file,
    line: test.location.line,
    column: test.location.column,
    projectName,
    status: test.outcome(),
    ok: test.ok(),
    duration: test.results.reduce((sum, r) => sum + r.duration, 0),
    retries: Math.max(0, test.results.length - 1),
    tags: test.tags,
    annotations: test.annotations.map(a => ({ type: a.type, description: a.description })),
    errors: (last?.errors ?? []).flatMap(e =>
      e.message ? [{ message: e.message, stack: e.stack, location: e.location }] : [],
    ),
    attachments: attachments.map(a => ({
      name: a.name,
      contentType: a.contentType,
      path: a.path,
      hasBody: a.body != null,
    })),
    ...a11y && { a11y },
  }
}

function countsOf(tests: NormTest[]): Counts {
  const counts: Counts = { total: tests.length, expected: 0, unexpected: 0, flaky: 0, skipped: 0 }
  for (const t of tests)
    counts[t.status]++
  return counts
}

export default class KinoraReporter implements Reporter {
  private suite: Suite | undefined
  private config: FullConfig | undefined

  constructor(private readonly options: KinoraReporterOptions) {}

  onBegin(config: FullConfig, suite: Suite): void {
    this.config = config
    this.suite = suite
  }

  async onEnd(result: FullResult): Promise<void> {
    const url = this.options.url ?? process.env.KINORA_URL ?? DEFAULT_KINORA_URL
    const token = this.options.token ?? process.env.KINORA_TOKEN
    if (!token) {
      console.warn('[kinora] skipping upload: missing token (set KINORA_TOKEN)')
      return
    }

    const tests = (this.suite?.allTests() ?? []).map(toNormTest)
    const detected = detectCiEnv(process.env)
    const shard = this.config?.shard
    const group = shard && this.options.groupKey !== false
      ? resolveShardGroup(process.env, { groupKey: this.options.groupKey, leg: this.prCommentLabel() })
      : undefined
    const baseUrls = [...new Set((this.config?.projects ?? []).flatMap(p => p.use.baseURL ? [p.use.baseURL] : []))]
    const payload: IngestRun = {
      project: { slug: this.options.project.slug, name: this.options.project.name ?? this.options.project.slug },
      run: {
        startedAt: result.startTime.toISOString(),
        duration: result.duration,
        counts: countsOf(tests),
        playwrightVersion: this.config?.version,
        git: this.options.git ?? detected.git,
        ci: this.options.ci ?? detected.ci,
        ...(baseUrls.length && { baseUrls }),
        ...(shard && group && { ...group, shard: { current: shard.current, total: shard.total } }),
      },
      tests,
    }

    try {
      const client = createIngestClient({ baseUrl: url, token, regression: !!this.options.prComment, onRetry: info => console.warn(`[kinora] ${describeRetry(info)}`) })
      const res = await client.uploadRun(payload)

      const kinds = this.options.uploadAttachments ?? DEFAULT_UPLOAD_ATTACHMENTS
      let artifacts = 0
      for (const t of tests) {
        for (const a of t.attachments) {
          if (!a.path || !isUploadableAttachment(a, kinds))
            continue
          try {
            await client.uploadArtifact({ runId: res.runId, testKey: t.testKey, name: a.name, contentType: a.contentType, body: await readFile(a.path) })
            artifacts++
          }
          catch (err) {
            console.warn(`[kinora] ${a.name} upload failed for ${t.testKey}:`, err instanceof Error ? err.message : err)
          }
        }
      }
      // eslint-disable-next-line no-console -- a reporter's job is to report
      console.log(`[kinora] uploaded ${res.tests} tests + ${artifacts} artifacts (run ${res.runId}${res.shardProgress ? `, ${res.shardProgress.landed} of ${res.shardProgress.total} shards` : ''})`)
      if (res.incident)
        console.warn(`[kinora] environment incident, not counted: ${res.incident.reason}`)

      await this.maybePostPrComment(payload, res)
    }
    catch (err) {
      if (err instanceof IngestError && err.status === 402)
        console.warn(`[kinora] ${err.message}`)
      else
        console.error(`[kinora] upload failed:`, err instanceof Error ? err.message : err)
    }
  }

  private prCommentLabel(): string | undefined {
    const opt = this.options.prComment
    return typeof opt === 'object' ? opt.label : undefined
  }

  // Best-effort PR/MR comment from the CI job. Never throws (mirrors "upload never fails the run").
  private async maybePostPrComment(payload: IngestRun, res: IngestRunResult): Promise<void> {
    if (!this.options.prComment)
      return
    const opt = this.options.prComment
    const label = this.prCommentLabel()
    const policy = typeof opt === 'object' ? opt.policy : undefined
    const grouped = !!payload.run.groupKey
    // Every shard of a grouped run updates the comment with the shards landed so far. A server
    // that predates grouping sends no progress: each shard is then a partial run of its own.
    if (grouped && !res.shardProgress)
      return
    try {
      // An ungrouped shard is a partial run: only the merged report (blob + merge-reports) comments.
      const env = this.config?.shard && !grouped ? { ...process.env, __KINORA_IS_SHARD: '1' } : process.env
      const ctx = resolvePrContext(env, (p) => {
        try {
          return readFileSync(p, 'utf8')
        }
        catch {
          return undefined
        }
      })
      if (!ctx)
        return
      const outcome = await postPrComment(ctx, {
        projectSlug: payload.project.slug,
        projectName: payload.project.name,
        label,
        runUrl: res.runUrl,
        ciRunUrl: payload.run.ci?.runUrl,
        counts: res.counts ?? payload.run.counts,
        regression: res.regression,
        flaky: res.flaky ?? flakyTestsOf(payload.tests),
        ...(res.shardProgress && { shards: { runId: res.runId, ...res.shardProgress } }),
        ...(res.incident && { incident: res.incident }),
      }, policy ?? 'always')
      if (outcome !== 'skipped')
        console.warn(`[kinora] PR comment ${outcome}`)
    }
    catch (err) {
      console.warn('[kinora] PR comment failed:', err instanceof Error ? err.message : err)
    }
  }
}
