import type { IngestRun, IngestRunResult, UploadArtifactResult } from '../contracts/ingest'
import type { CiMeta, GitMeta } from '../contracts/kinora'
import type { ShardGroup } from './shards'
import { ingestRunResultSchema, uploadArtifactResultSchema } from '../contracts/ingest'
import { pwConfigSchema } from '../contracts/playwright'
import { isSnapshotImage } from './attachments'
import { ingestPlaywrightReport } from './normalize'

// Hosted ingest endpoint. Reporter/CLI fall back to this when no url is given; self-host overrides.
export const DEFAULT_KINORA_URL = 'https://api.kinora.dev'

export interface BuildIngestRunOptions {
  project: { slug: string, name: string }
  git?: GitMeta
  ci?: CiMeta
  shards?: number
  // Group a sharded report (its `config.shard`) into the run of its CI run. Ignored when unsharded.
  group?: ShardGroup
}

// Map a raw Playwright JSON report into the ingest wire payload. Shared by the
// CLI (reads results.json) - the reporter maps the reporter API directly.
export function buildIngestRun(raw: unknown, opts: BuildIngestRunOptions): IngestRun {
  const { report } = ingestPlaywrightReport(raw, {
    projectId: '',
    runId: '',
    git: opts.git,
    ci: opts.ci,
  })
  const shard = opts.group ? pwConfigSchema.safeParse((raw as { config?: unknown } | null)?.config).data?.shard : undefined
  return {
    project: opts.project,
    run: {
      startedAt: report.startedAt,
      duration: report.duration,
      counts: report.counts,
      playwrightVersion: report.meta.playwrightVersion,
      git: opts.git,
      ci: opts.ci,
      shards: opts.shards,
      ...(shard && opts.group && { ...opts.group, shard }),
    },
    tests: report.tests,
  }
}

export interface IngestClientOptions {
  baseUrl: string
  token: string
  fetch?: typeof globalThis.fetch
  // Historical/bulk import: tells the server to skip alerts for these runs.
  backfill?: boolean
  // Ask the server to include a regression summary in the run response (for the PR comment).
  regression?: boolean
  // Waits between attempts on a transient failure; the default rides out a ~1 minute server restart.
  retryDelays?: readonly number[]
  onRetry?: (info: { error: unknown, attempt: number, delayMs: number }) => void
}

export interface UploadArtifactInput {
  runId: string
  testKey: string
  name: string
  contentType: string
  body: Uint8Array | Blob
}

// 500 is left out: an application error, which a retry would only repeat.
const RETRYABLE_STATUSES = new Set([408, 429, 502, 503, 504])
export const DEFAULT_RETRY_DELAYS = [1000, 2000, 4000, 8000, 15000, 30000]

export class IngestError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'IngestError'
    this.status = status
  }
}

// Prefer the server's JSON `error` field (human-readable, e.g. plan-limit messages).
export async function toIngestError(res: Response, fallback: string): Promise<IngestError> {
  const text = await res.text()
  let message = text || fallback
  try {
    const body = JSON.parse(text) as { error?: unknown }
    if (typeof body.error === 'string')
      message = body.error
  }
  catch {
    // non-JSON body: keep the raw text / fallback
  }
  return new IngestError(res.status, message)
}

// fetch rejects with a TypeError when the server can't be reached (refused, reset, DNS).
export function isTransientIngestError(err: unknown): boolean {
  if (err instanceof IngestError)
    return RETRYABLE_STATUSES.has(err.status)
  return err instanceof TypeError
}

export function describeRetry(info: { error: unknown, delayMs: number }): string {
  const cause = info.error instanceof IngestError ? `HTTP ${info.error.status}` : info.error instanceof Error ? info.error.message : String(info.error)
  return `kinora server unavailable (${cause}), retrying in ${Math.round(info.delayMs / 1000)}s`
}

async function wait(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export function createIngestClient(opts: IngestClientOptions) {
  let end = opts.baseUrl.length
  while (end > 0 && opts.baseUrl[end - 1] === '/')
    end--
  const base = opts.baseUrl.slice(0, end)
  const doFetch = opts.fetch ?? globalThis.fetch
  const auth = `Bearer ${opts.token}`
  const params = new URLSearchParams()
  if (opts.backfill)
    params.set('backfill', '1')
  if (opts.regression)
    params.set('regression', '1')
  const query = params.toString()
  const runsUrl = `${base}/api/v1/runs${query ? `?${query}` : ''}`
  const retryDelays = opts.retryDelays ?? DEFAULT_RETRY_DELAYS
  // Once a call has waited out every retry, the server is down: later calls fail fast instead of
  // each waiting the full window again (one per artifact).
  let unreachable = false

  async function withRetry<T>(attemptOnce: () => Promise<T>): Promise<T> {
    const delays = unreachable ? [] : retryDelays
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await attemptOnce()
        unreachable = false
        return result
      }
      catch (err) {
        if (!isTransientIngestError(err))
          throw err
        if (attempt >= delays.length) {
          unreachable = true
          throw err
        }
        const delayMs = delays[attempt] + Math.floor(Math.random() * delays[attempt] * 0.2)
        opts.onRetry?.({ error: err, attempt: attempt + 1, delayMs })
        await wait(delayMs)
      }
    }
  }

  return {
    async uploadRun(input: IngestRun): Promise<IngestRunResult> {
      const body = JSON.stringify(input)
      // Same key on every attempt: a retry after a lost response returns the stored run, not a duplicate.
      const idempotencyKey = globalThis.crypto.randomUUID()
      return withRetry(async () => {
        const res = await doFetch(runsUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'authorization': auth, 'idempotency-key': idempotencyKey },
          body,
        })
        if (!res.ok)
          throw await toIngestError(res, `kinora ingest failed (${res.status})`)
        return ingestRunResultSchema.parse(await res.json())
      })
    },

    async uploadArtifact(input: UploadArtifactInput): Promise<UploadArtifactResult> {
      // Cast the typed-array generic so this compiles under both node and DOM libs.
      const blob = input.body instanceof Blob ? input.body : new Blob([input.body as Uint8Array<ArrayBuffer>], { type: input.contentType })
      const url = `${base}/api/v1/runs/${encodeURIComponent(input.runId)}/artifacts`
      return withRetry(async () => {
        const form = new FormData()
        form.set('file', blob, input.name)
        form.set('testKey', input.testKey)
        form.set('name', input.name)
        // No content-type header: fetch sets the multipart boundary.
        const res = await doFetch(url, {
          method: 'POST',
          headers: { authorization: auth },
          body: form,
        })
        if (!res.ok)
          throw await toIngestError(res, `kinora artifact upload failed (${res.status})`)
        return uploadArtifactResultSchema.parse(await res.json())
      })
    },
  }
}

// `snapshot` = the expected / actual / diff images of a failed screenshot assertion. They only
// exist on a failure and feed the dashboard's comparison view, hence uploaded by default.
// `screenshot` = any image, snapshots included.
export type AttachmentKind = 'trace' | 'video' | 'screenshot' | 'snapshot'

export const DEFAULT_UPLOAD_ATTACHMENTS: AttachmentKind[] = ['trace', 'snapshot']

// Trace-like attachments worth uploading (the viewer's flagship input).
export function isTraceAttachment(a: { name: string, contentType: string, path?: string }): boolean {
  return !!a.path && (a.name === 'trace' || a.contentType === 'application/zip' || a.path.endsWith('.zip'))
}

// null = nothing we know how to host (text/plain logs, markdown annotations, ...).
export function attachmentKind(a: { name: string, contentType: string, path?: string }): AttachmentKind | null {
  if (!a.path)
    return null
  if (isTraceAttachment(a))
    return 'trace'
  if (a.contentType.startsWith('video/'))
    return 'video'
  if (a.contentType.startsWith('image/'))
    return isSnapshotImage(a) ? 'snapshot' : 'screenshot'
  return null
}

export function isUploadableAttachment(a: { name: string, contentType: string, path?: string }, kinds: readonly AttachmentKind[]): boolean {
  const kind = attachmentKind(a)
  if (kind === null)
    return false
  // Asking for every screenshot covers the snapshot images too.
  return kinds.includes(kind) || (kind === 'snapshot' && kinds.includes('screenshot'))
}
