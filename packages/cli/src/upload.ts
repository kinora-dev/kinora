import type { AttachmentKind, CiMeta, Counts, GitMeta, IngestRunResult, ShardGroup } from '@kinora/core'
import { readFile } from 'node:fs/promises'
import { buildIngestRun, createIngestClient, DEFAULT_UPLOAD_ATTACHMENTS, describeRetry, flakyTestsOf, isUploadableAttachment } from '@kinora/core'

// `counts` / `flaky`: the run's, which the PR comment shows. For a grouped shard, the server's view
// of every shard landed so far; `grouped` says the upload carried a group key.
export type UploadResult = IngestRunResult & { counts: Counts, flaky: ReturnType<typeof flakyTestsOf>, grouped: boolean }

export interface UploadOptions {
  project: { slug: string, name?: string }
  url: string
  token: string
  git?: GitMeta
  ci?: CiMeta
  fetch?: typeof globalThis.fetch
  // Ask the server to return a regression summary (for --pr-comment).
  regression?: boolean
  // Attachment kinds to upload; defaults to traces only.
  uploadAttachments?: AttachmentKind[]
  // A sharded report lands in the run of this CI run (see resolveShardGroup).
  group?: ShardGroup
  // The app's `baseURL`s, so the server can tell an environment incident on its host.
  baseUrls?: string[]
}

// Parse a Playwright json report and upload it to a kinora server. Shares the
// normalize + ingest-client logic with the reporter via @kinora/core.
export async function uploadReport(raw: unknown, opts: UploadOptions): Promise<UploadResult> {
  const payload = buildIngestRun(raw, {
    project: { slug: opts.project.slug, name: opts.project.name ?? opts.project.slug },
    git: opts.git,
    ci: opts.ci,
    group: opts.group,
    baseUrls: opts.baseUrls,
  })
  const client = createIngestClient({
    baseUrl: opts.url,
    token: opts.token,
    fetch: opts.fetch,
    regression: opts.regression,
    onRetry: info => console.warn(`warning: ${describeRetry(info)}`),
  })
  const res = await client.uploadRun(payload)

  const kinds = opts.uploadAttachments ?? DEFAULT_UPLOAD_ATTACHMENTS
  for (const t of payload.tests) {
    for (const a of t.attachments) {
      if (!a.path || !isUploadableAttachment(a, kinds))
        continue
      try {
        const art = await client.uploadArtifact({ runId: res.runId, testKey: t.testKey, name: a.name, contentType: a.contentType, body: await readFile(a.path) })
        console.log(`  ${a.name} ${t.testKey} -> ${art.url}`)
      }
      catch (err) {
        console.warn(`warning: ${a.name} upload failed for ${t.testKey}: ${err instanceof Error ? err.message : err}`)
      }
    }
  }

  return {
    ...res,
    counts: res.counts ?? payload.run.counts,
    flaky: res.flaky ?? flakyTestsOf(payload.tests),
    grouped: !!payload.run.groupKey,
  }
}
