import type { IngestRun, IngestRunResult, UploadArtifactResult } from '../contracts/ingest'
import type { CiMeta, GitMeta } from '../contracts/kinora'
import { ingestRunResultSchema, uploadArtifactResultSchema } from '../contracts/ingest'
import { ingestPlaywrightReport } from './normalize'

// Hosted ingest endpoint. Reporter/CLI fall back to this when no url is given; self-host overrides.
export const DEFAULT_KINORA_URL = 'https://api.kinora.dev'

export interface BuildIngestRunOptions {
  project: { slug: string, name: string }
  git?: GitMeta
  ci?: CiMeta
  shards?: number
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
}

export interface UploadArtifactInput {
  runId: string
  testKey: string
  name: string
  contentType: string
  body: Uint8Array | Blob
}

const RETRYABLE_ARTIFACT_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const ARTIFACT_UPLOAD_MAX_ATTEMPTS = 3

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

function isRetryableArtifactError(err: unknown): boolean {
  if (err instanceof IngestError)
    return RETRYABLE_ARTIFACT_STATUSES.has(err.status)
  return err instanceof TypeError
}

function artifactRetryDelay(attempt: number): number {
  return 100 * 2 ** attempt + Math.floor(Math.random() * 50)
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

  return {
    async uploadRun(input: IngestRun): Promise<IngestRunResult> {
      const res = await doFetch(runsUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'authorization': auth },
        body: JSON.stringify(input),
      })
      if (!res.ok)
        throw await toIngestError(res, `kinora ingest failed (${res.status})`)
      return ingestRunResultSchema.parse(await res.json())
    },

    async uploadArtifact(input: UploadArtifactInput): Promise<UploadArtifactResult> {
      // Cast the typed-array generic so this compiles under both node and DOM libs.
      const blob = input.body instanceof Blob ? input.body : new Blob([input.body as Uint8Array<ArrayBuffer>], { type: input.contentType })
      const url = `${base}/api/v1/runs/${encodeURIComponent(input.runId)}/artifacts`
      for (let attempt = 0; attempt < ARTIFACT_UPLOAD_MAX_ATTEMPTS; attempt++) {
        try {
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
        }
        catch (err) {
          if (attempt === ARTIFACT_UPLOAD_MAX_ATTEMPTS - 1 || !isRetryableArtifactError(err))
            throw err
          await wait(artifactRetryDelay(attempt))
        }
      }
      throw new IngestError(0, 'kinora artifact upload failed')
    },
  }
}

export type AttachmentKind = 'trace' | 'video' | 'screenshot'

export const DEFAULT_UPLOAD_ATTACHMENTS: AttachmentKind[] = ['trace']

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
    return 'screenshot'
  return null
}

export function isUploadableAttachment(a: { name: string, contentType: string, path?: string }, kinds: readonly AttachmentKind[]): boolean {
  const kind = attachmentKind(a)
  return kind !== null && kinds.includes(kind)
}
