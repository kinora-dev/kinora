import type { PrCommentInput, PrContext } from './pr-comment'

// A GitHub commit status on the PR's head commit: the run's verdict in the PR checks, which branch
// protection can require. Red only for what the PR broke (newly failing vs its baseline), so a
// test already failing on the base branch, or a flaky one, does not block the merge.

export type PrStatusInput = Pick<PrCommentInput, 'projectSlug' | 'label' | 'runUrl' | 'counts' | 'regression' | 'shards' | 'incident'> & {
  // Named in the description ("vs main"); falls back to "base branch".
  baseBranch?: string
}

export type PrStatusState = 'success' | 'failure' | 'pending'

export interface PrStatus {
  context: string
  state: PrStatusState
  description: string
}

const MAX_DESCRIPTION = 140 // GitHub rejects longer status descriptions

export function prStatusContext(projectSlug: string, label?: string): string {
  return `kinora / ${projectSlug}${label ? ` (${label})` : ''}`
}

export function buildPrStatus(input: PrStatusInput): PrStatus {
  const { counts, shards, incident } = input
  const context = prStatusContext(input.projectSlug, input.label)
  const status = (state: PrStatusState, description: string): PrStatus => ({ context, state, description: description.slice(0, MAX_DESCRIPTION) })

  if (shards && shards.landed < shards.total)
    return status('pending', `${shards.landed} of ${shards.total} shards landed`)
  // Red, not green: nothing was tested, so the change must not merge on it.
  if (incident)
    return status('failure', 'Environment incident, not counted: re-run once the app is back')

  const flaky = counts.flaky > 0 ? ` · ${counts.flaky} flaky` : ''
  const regression = input.regression?.base === 'none' ? undefined : input.regression
  if (!regression) {
    if (counts.unexpected > 0)
      return status('failure', `${counts.unexpected} failed, no baseline to compare against`)
    return status('success', `${counts.expected + counts.flaky}/${counts.total} passed${flaky}`)
  }

  const vs = regression.base === 'base-branch' ? (input.baseBranch || 'base branch') : 'previous run'
  if (regression.newlyFailing.length)
    return status('failure', `${regression.newlyFailing.length} newly failing vs ${vs}`)
  const already = counts.unexpected > 0 ? ` · ${counts.unexpected} already failing` : ''
  return status('success', `No new failures vs ${vs}${already}${flaky}`)
}

interface GhStatus { context?: string, state?: string, description?: string | null, target_url?: string | null }

// Shards land in any order: an older view of the same run (fewer shards landed) must not
// overwrite a newer one, nor a final verdict. Statuses of the same run share its target URL.
function isStale(latest: GhStatus | undefined, next: PrStatus, input: PrStatusInput): boolean {
  if (!latest || !input.runUrl || latest.target_url !== input.runUrl || next.state !== 'pending')
    return false
  if (latest.state !== 'pending')
    return true
  const landed = Number(latest.description?.match(/^(\d+) of \d+ shards landed/)?.[1] ?? 0)
  return landed > (input.shards?.landed ?? 0)
}

// Never throws on a fork PR, whose read-only GITHUB_TOKEN gets a 403: that is a skip.
export async function postPrStatus(
  ctx: PrContext,
  input: PrStatusInput,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<'posted' | 'skipped'> {
  if (ctx.isShard || ctx.provider !== 'github' || !ctx.headSha)
    return 'skipped'
  const headers = {
    'authorization': `Bearer ${ctx.token}`,
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  }
  const base = `${ctx.apiUrl}/repos/${ctx.owner}/${ctx.repo}`
  const next = buildPrStatus(input)

  if (next.state === 'pending') {
    // Newest first, so the first one of our context is the current status.
    const listRes = await fetchImpl(`${base}/commits/${ctx.headSha}/statuses?per_page=100`, { headers })
    if (!listRes.ok) {
      if (listRes.status === 403)
        return 'skipped'
      throw new Error(`github: list statuses failed (${listRes.status})`)
    }
    const latest = ((await listRes.json()) as GhStatus[]).find(s => s.context === next.context)
    if (isStale(latest, next, input))
      return 'skipped'
  }

  const res = await fetchImpl(`${base}/statuses/${ctx.headSha}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ state: next.state, context: next.context, description: next.description, ...(input.runUrl && { target_url: input.runUrl }) }),
  })
  if (!res.ok) {
    if (res.status === 403)
      return 'skipped'
    throw new Error(`github: create status failed (${res.status})`)
  }
  return 'posted'
}
