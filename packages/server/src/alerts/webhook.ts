import type { Counts, RunIncident, ShardProgress } from '@kinora/core'
import type { Fetcher } from '../lib/ssrf'
import type { AlertPayload } from './core'
import { safeFetch } from '../lib/ssrf'

// Stable JSON contract for consumers - keep field names stable across versions.
export interface WebhookBody {
  project: string
  runUrl: string
  counts: Counts
  newlyFailing: string[]
  newlyFlaky: string[]
  codeOwners?: Record<string, string[]>
  // Set on a sharded run closed with shards missing.
  incomplete?: ShardProgress
  // Set when the run is an environment incident; newlyFailing / newlyFlaky are then empty.
  incident?: RunIncident
}

export async function postWebhook(
  url: string,
  p: AlertPayload,
  fetchImpl: Fetcher = safeFetch,
): Promise<void> {
  const body: WebhookBody = {
    project: p.projectName,
    runUrl: p.runUrl,
    counts: p.counts,
    newlyFailing: p.newlyFailing,
    newlyFlaky: p.newlyFlaky,
    codeOwners: p.codeOwners,
    ...(p.incomplete && { incomplete: p.incomplete }),
    ...(p.incident && { incident: p.incident }),
  }
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok)
    throw new Error(`webhook responded ${res.status}`)
}
