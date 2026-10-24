import type { AttachmentKind, CiMeta, Counts, GitMeta, IngestRun, NormTest } from '@kinora/core'
import type { Reporter, TestModule, Vitest } from 'vitest/node'
import type { IncludeTests } from './convert'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { createIngestClient, DEFAULT_KINORA_URL, DEFAULT_UPLOAD_ATTACHMENTS, describeRetry, detectCiEnv, IngestError, isUploadableAttachment, resolveShardGroup } from '@kinora/core'
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
    const group = this.shard && this.options.groupKey !== false
      ? resolveShardGroup(process.env, { groupKey: this.options.groupKey })
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
      const client = createIngestClient({ baseUrl: url, token, onRetry: info => console.warn(`[kinora] ${describeRetry(info)}`) })
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
    }
    catch (err) {
      if (err instanceof IngestError && err.status === 402)
        console.warn(`[kinora] ${err.message}`)
      else
        console.error('[kinora] upload failed:', err instanceof Error ? err.message : err)
    }
  }
}
