import type { GitHubPrContext, GitLabMrContext, PrCommentInput, PrContext } from './pr-comment'

// A commit status with the run's verdict: in the GitHub PR checks, which branch protection can
// require, or as an external job of the GitLab MR pipeline, which "Pipelines must succeed" gates. Red only for what the PR broke (newly failing vs its baseline), so a
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

// One shape for both providers: GitHub's `state` / `context`, GitLab's `status` / `name`.
interface CurrentStatus { state?: string, description?: string | null, targetUrl?: string | null }

// Shards land in any order: an older view of the same run (fewer shards landed) must not
// overwrite a newer one, nor a final verdict. Statuses of the same run share its target URL.
function isStale(current: CurrentStatus | undefined, next: PrStatus, input: PrStatusInput): boolean {
  if (!current || !input.runUrl || current.targetUrl !== input.runUrl || next.state !== 'pending')
    return false
  if (current.state !== 'pending')
    return true
  const landed = Number(current.description?.match(/^(\d+) of \d+ shards landed/)?.[1] ?? 0)
  return landed > (input.shards?.landed ?? 0)
}

export type PrStatusOutcome = 'posted' | 'skipped'

// A fork's read-only token (GitHub 403) is a skip, not an error.
export async function postPrStatus(
  ctx: PrContext,
  input: PrStatusInput,
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<PrStatusOutcome> {
  if (ctx.isShard)
    return 'skipped'
  const next = buildPrStatus(input)
  return ctx.provider === 'gitlab'
    ? postGitLabStatus(ctx, next, input, fetchImpl)
    : postGitHubStatus(ctx, next, input, fetchImpl)
}

async function postGitHubStatus(ctx: GitHubPrContext, next: PrStatus, input: PrStatusInput, fetchImpl: typeof globalThis.fetch): Promise<PrStatusOutcome> {
  if (!ctx.headSha)
    return 'skipped'
  const headers = {
    'authorization': `Bearer ${ctx.token}`,
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  }
  const base = `${ctx.apiUrl}/repos/${ctx.owner}/${ctx.repo}`

  if (next.state === 'pending') {
    // Newest first, so the first one of our context is the current status.
    const listRes = await fetchImpl(`${base}/commits/${ctx.headSha}/statuses?per_page=100`, { headers })
    if (!listRes.ok) {
      if (listRes.status === 403)
        return 'skipped'
      throw new Error(`github: list statuses failed (${listRes.status})`)
    }
    const latest = ((await listRes.json()) as { context?: string, state?: string, description?: string | null, target_url?: string | null }[])
      .find(s => s.context === next.context)
    if (isStale(latest && { state: latest.state, description: latest.description, targetUrl: latest.target_url }, next, input))
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

const GITLAB_STATE = { success: 'success', failure: 'failed', pending: 'running' } as const

// GITLAB_TOKEN is set on purpose, so a rejected call is a misconfiguration worth surfacing (unlike
// GitHub's read-only fork token): it throws, except a state GitLab will not move to (a pending
// status sent twice), which leaves the current one standing.
async function postGitLabStatus(ctx: GitLabMrContext, next: PrStatus, input: PrStatusInput, fetchImpl: typeof globalThis.fetch): Promise<PrStatusOutcome> {
  if (!ctx.commit)
    return 'skipped'
  const { projectId, sha, pipelineId } = ctx.commit
  const headers = { 'private-token': ctx.token, 'content-type': 'application/json' }
  const base = `${ctx.apiUrl}/projects/${encodeURIComponent(projectId)}`

  if (next.state === 'pending') {
    const query = new URLSearchParams({ name: next.context, per_page: '100' })
    const listRes = await fetchImpl(`${base}/repository/commits/${sha}/statuses?${query}`, { headers })
    if (!listRes.ok)
      throw new Error(`gitlab: list statuses failed (${listRes.status})`)
    const ours = ((await listRes.json()) as { id: number, name?: string, status?: string, description?: string | null, target_url?: string | null }[])
      .filter(s => s.name === next.context)
    const latest = ours.reduce<typeof ours[number] | undefined>((a, b) => !a || b.id > a.id ? b : a, undefined)
    const state = latest?.status === 'running' || latest?.status === 'pending' ? 'pending' : latest?.status
    if (isStale(latest && { state, description: latest.description, targetUrl: latest.target_url }, next, input))
      return 'skipped'
  }

  const res = await fetchImpl(`${base}/statuses/${sha}`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      state: GITLAB_STATE[next.state],
      name: next.context,
      description: next.description,
      ...(input.runUrl && { target_url: input.runUrl }),
      ...(pipelineId && { pipeline_id: pipelineId }),
    }),
  })
  if (!res.ok) {
    if (res.status === 400 && /cannot transition/i.test(await res.text()))
      return 'skipped'
    throw new Error(`gitlab: create status failed (${res.status})`)
  }
  return 'posted'
}
