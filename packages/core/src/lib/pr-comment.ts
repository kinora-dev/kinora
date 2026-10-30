import type { RunRegression } from '../contracts/ingest'
import type { Counts, NormTest, RunIncident, ShardProgress } from '../contracts/kinora'
import { rerunAttemptOf } from './shards'

type ListedTest = RunRegression['newlyFlaky'][number]
// A flaky test of the run; `rerunAttempt` when it only passed on a CI re-run of its shard.
export type FlakyTest = ListedTest & { rerunAttempt?: number }

// Post/update a single PR/MR comment from the CI job: on GitHub with the ambient GITHUB_TOKEN, on
// GitLab with a GITLAB_TOKEN CI variable (the job token can only read merge request notes).
// env + file reads are injected so this module stays node-free (safe to bundle for the web).

interface PrContextBase {
  token: string
  isShard: boolean // a per-shard run: skip so only the merged/single run comments
}

export interface GitHubPrContext extends PrContextBase {
  provider: 'github'
  apiUrl: string // GITHUB_API_URL (differs on GHES)
  owner: string
  repo: string
  prNumber: number
}

export interface GitLabMrContext extends PrContextBase {
  provider: 'gitlab'
  apiUrl: string // CI_API_V4_URL (differs on self-managed)
  projectId: string // the project the MR lives in (the target project for a fork MR)
  mrIid: number
}

export type PrContext = GitHubPrContext | GitLabMrContext

export type PrCommentPolicy = 'always' | 'on-failure'

export interface PrCommentInput {
  projectSlug: string
  projectName: string
  label?: string // distinguishes matrix legs sharing a PR
  runUrl?: string
  ciRunUrl?: string
  counts: Counts
  regression?: RunRegression
  // The run's flaky tests (passed on a retry), named in the comment. The regression only knows the
  // newly flaky ones; the rest come from the uploader, which has the whole run.
  flaky?: FlakyTest[]
  // A grouped (sharded) run: until every shard landed, the comment shows the shards landed so far
  // and updates as the next ones land. `runId` keeps a slower shard from overwriting a newer state.
  shards?: ShardProgress & { runId: string }
  // The run is an environment incident: no verdict on the change, so no regression lists.
  incident?: Pick<RunIncident, 'reason'>
}

// The flaky tests of a run, as the comment lists them.
export function flakyTestsOf(tests: (Pick<NormTest, 'testKey' | 'title' | 'file' | 'status'> & Partial<Pick<NormTest, 'annotations'>>)[]): FlakyTest[] {
  return tests.filter(t => t.status === 'flaky').map(({ testKey, title, file, annotations }) => {
    const rerunAttempt = rerunAttemptOf(annotations ?? [])
    return { testKey, title, file, ...(rerunAttempt && { rerunAttempt }) }
  })
}

const MAX_LISTED = 15 // cap the failing-test list so the comment stays under GitHub's size limit

// Resolve the PR/MR context from CI env. Returns null when not a pull/merge request run with a token.
export function resolvePrContext(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string | undefined,
): PrContext | null {
  return env.GITLAB_CI ? resolveGitLabContext(env) : resolveGitHubContext(env, readFile)
}

// Merge request pipelines only: CI_MERGE_REQUEST_IID is unset on branch pipelines.
function resolveGitLabContext(env: Record<string, string | undefined>): GitLabMrContext | null {
  const token = env.GITLAB_TOKEN
  const projectId = env.CI_MERGE_REQUEST_PROJECT_ID || env.CI_PROJECT_ID
  const mrIid = Number(env.CI_MERGE_REQUEST_IID)
  if (!token || !projectId || !Number.isInteger(mrIid) || mrIid <= 0)
    return null
  return {
    provider: 'gitlab',
    token,
    apiUrl: env.CI_API_V4_URL || 'https://gitlab.com/api/v4',
    projectId,
    mrIid,
    isShard: !!env.__KINORA_IS_SHARD,
  }
}

function resolveGitHubContext(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string | undefined,
): GitHubPrContext | null {
  const token = env.GITHUB_TOKEN
  const eventName = env.GITHUB_EVENT_NAME
  const repository = env.GITHUB_REPOSITORY
  if (!token || !repository)
    return null
  // pull_request only: pull_request_target grants a write token to fork-authored content, which
  // would let a fork inject into a comment posted under privileged credentials.
  if (eventName !== 'pull_request')
    return null

  const [owner, repo] = repository.split('/')
  if (!owner || !repo)
    return null

  const prNumber = prNumberFrom(env, readFile)
  if (prNumber == null)
    return null

  return {
    provider: 'github',
    token,
    apiUrl: env.GITHUB_API_URL || 'https://api.github.com',
    owner,
    repo,
    prNumber,
    isShard: !!env.__KINORA_IS_SHARD, // set by the reporter when config.shard is present
  }
}

function prNumberFrom(env: Record<string, string | undefined>, readFile: (path: string) => string | undefined): number | null {
  // Event payload is the reliable source; fall back to parsing refs/pull/<N>/merge.
  const eventPath = env.GITHUB_EVENT_PATH
  if (eventPath) {
    try {
      const raw = readFile(eventPath)
      if (raw) {
        const event = JSON.parse(raw) as { pull_request?: { number?: number }, number?: number }
        const n = event.pull_request?.number ?? event.number
        if (typeof n === 'number')
          return n
      }
    }
    catch {
      // fall through to ref parsing
    }
  }
  const m = env.GITHUB_REF?.match(/^refs\/pull\/(\d+)\//)
  return m ? Number(m[1]) : null
}

function marker(projectSlug: string, label?: string): string {
  return `<!-- kinora:pr:${projectSlug}${label ? `:${label}` : ''} -->`
}

// Shards landed so far for a run, on the line right above the marker.
function progressMarker(runId: string, landed: number): string {
  return `<!-- kinora:shards:${runId}:${landed} -->`
}

// Shards land in any order and their uploads race: a shard whose view of the run is older than
// the comment's (fewer shards landed, same run) must leave it alone. A new run always replaces it.
function isStale(existingBody: string, shards: PrCommentInput['shards']): boolean {
  const m = existingBody.trimEnd().split('\n').at(-2)?.match(/^<!-- kinora:shards:(.+):(\d+) -->$/)
  return !!m && !!shards && m[1] === shards.runId && Number(m[2]) > shards.landed
}

// Untrusted test titles/paths go through an inline code span so GitHub won't autolink @mentions /
// #refs, render markdown, or let a crafted title emit the HTML-comment marker.
function inlineCode(s: string): string {
  return `\`${s.replace(/`/g, '‘').replace(/\r?\n/g, ' ')}\``
}

// The run page narrowed to one test (`?test=<testKey>`): its trace is one click away, signed when
// the page opens, so the link outlives the trace URL. Parentheses are escaped too: they would end
// the markdown link.
function testUrl(runUrl: string, testKey: string): string {
  const key = encodeURIComponent(testKey).replace(/[()]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
  return `${runUrl}${runUrl.includes('?') ? '&' : '?'}test=${key}`
}

// A titled list of tests, capped so the comment stays under GitHub's size limit. With the run's
// URL, each test links to it.
function pushTests(lines: string[], heading: string, tests: ListedTest[], runUrl?: string, reruns?: Map<string, number>): void {
  lines.push('')
  lines.push(heading)
  for (const t of tests.slice(0, MAX_LISTED)) {
    const name = `${inlineCode(t.file)} › ${inlineCode(t.title)}`
    const attempt = reruns?.get(t.testKey)
    lines.push(`- ${runUrl ? `[${name}](${testUrl(runUrl, t.testKey)})` : name}${attempt ? ` · passed on re-run (attempt ${attempt})` : ''}`)
  }
  if (tests.length > MAX_LISTED)
    lines.push(`- …and ${tests.length - MAX_LISTED} more`)
}

export function buildPrCommentBody(input: PrCommentInput): string {
  const { counts, shards } = input
  const partial = shards && shards.landed < shards.total ? shards : undefined
  // A run missing shards is never compared: its baseline diff would count the missing tests.
  const { incident } = input
  const regression = partial || incident ? undefined : input.regression
  const failed = counts.unexpected
  const icon = incident ? '⚠️' : failed > 0 ? '❌' : partial ? '⏳' : counts.flaky > 0 ? '⚠️' : '✅'
  const lines: string[] = []
  // Re-run marks apply to every list a flaky test shows up in, new flakes included.
  const reruns = new Map((input.flaky ?? []).flatMap(t => t.rerunAttempt ? [[t.testKey, t.rerunAttempt] as const] : []))

  lines.push(`${icon} **kinora** · ${input.projectName}${partial ? ` · ${partial.landed} of ${partial.total} shards landed` : ''}${incident ? ' · environment incident' : ''}`)
  lines.push('')
  lines.push(`\`${counts.expected + counts.flaky}/${counts.total} passed\` · **${failed} failed** · ${counts.flaky} flaky · ${counts.skipped} skipped${partial ? ' so far' : ''}`)
  if (partial)
    lines.push('', 'The other shards have not uploaded yet: this comment updates as they land.')
  if (incident)
    lines.push('', `**Environment incident, not counted.** ${incident.reason} Re-run once the environment is back, or clear the flag on the run page if it is wrong.`)

  const compared = regression && regression.base !== 'none' ? regression : undefined
  const vs = compared?.base === 'base-branch' ? 'base branch' : 'previous run'
  // New flakes first, named against the baseline; then the run's other flaky tests, which were
  // already flaky there. Without a baseline, every flaky test of the run.
  const newlyFlaky = compared?.newlyFlaky ?? []
  const newKeys = new Set(newlyFlaky.map(t => t.testKey))
  const otherFlaky = (input.flaky ?? []).filter(t => !newKeys.has(t.testKey))

  if (compared) {
    if (compared.newlyFailing.length)
      pushTests(lines, `**${compared.newlyFailing.length} newly failing** vs ${vs}:`, compared.newlyFailing, input.runUrl)
    if (newlyFlaky.length)
      pushTests(lines, `**${newlyFlaky.length} newly flaky** vs ${vs}:`, newlyFlaky, input.runUrl, reruns)
    if (otherFlaky.length)
      pushTests(lines, `**${otherFlaky.length} ${newlyFlaky.length ? 'more ' : ''}flaky**, already flaky on the ${vs}:`, otherFlaky, input.runUrl, reruns)
    if (compared.fixed > 0)
      lines.push(`\n✅ ${compared.fixed} fixed vs ${vs}.`)
    if (!compared.newlyFailing.length && !newlyFlaky.length && compared.fixed === 0)
      lines.push(`\nNo change vs ${vs}.`)
  }
  else if (otherFlaky.length && !incident) {
    pushTests(lines, `**${otherFlaky.length} flaky**:`, otherFlaky, input.runUrl, reruns)
  }

  const links: string[] = []
  if (input.runUrl)
    links.push(`[View run in kinora](${input.runUrl})`)
  if (input.ciRunUrl)
    links.push(`[CI run](${input.ciRunUrl})`)
  if (links.length) {
    lines.push('')
    lines.push(links.join(' · '))
  }

  lines.push('')
  if (shards)
    lines.push(progressMarker(shards.runId, shards.landed))
  lines.push(marker(input.projectSlug, input.label))
  return lines.join('\n')
}

interface GhComment { id: number, body?: string, user?: { type?: string } }
interface GlNote { id: number, body?: string, system?: boolean, author?: { id?: number } }

type UpsertOutcome = 'created' | 'updated' | 'skipped'

// Upsert the comment: update our previous comment (carrying the marker), else create one.
export async function postPrComment(
  ctx: PrContext,
  input: PrCommentInput,
  policy: PrCommentPolicy = 'always',
  fetchImpl: typeof globalThis.fetch = globalThis.fetch,
): Promise<UpsertOutcome> {
  if (ctx.isShard)
    return 'skipped'
  // A green run under `on-failure` posts no new comment, but still updates the one an earlier
  // failing run of the PR left: otherwise a fix, or a re-run that passes, would leave it red.
  // newlyFailing entries always have an unexpected head status, so counts.unexpected===0 covers them.
  const create = !(policy === 'on-failure' && input.counts.unexpected === 0)

  const body = buildPrCommentBody(input)
  const mark = marker(input.projectSlug, input.label)
  const keep = (existing: string): boolean => isStale(existing, input.shards)
  return ctx.provider === 'gitlab'
    ? upsertGitLabNote(ctx, body, mark, create, keep, fetchImpl)
    : upsertGitHubComment(ctx, body, mark, create, keep, fetchImpl)
}

// A fork PR's GITHUB_TOKEN is read-only, so writes 403 -> treated as skipped, not an error.
async function upsertGitHubComment(ctx: GitHubPrContext, body: string, mark: string, create: boolean, keep: (existing: string) => boolean, fetchImpl: typeof globalThis.fetch): Promise<UpsertOutcome> {
  const headers = {
    'authorization': `Bearer ${ctx.token}`,
    'accept': 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'content-type': 'application/json',
  }
  const base = `${ctx.apiUrl}/repos/${ctx.owner}/${ctx.repo}`

  // Page through comments; only our own bot comment carrying the marker is a valid upsert target
  // (a human comment quoting the marker must not be hijacked).
  let existing: GhComment | undefined
  for (let page = 1; ; page++) {
    const listRes = await fetchImpl(`${base}/issues/${ctx.prNumber}/comments?per_page=100&page=${page}`, { headers })
    if (!listRes.ok) {
      if (listRes.status === 403)
        return 'skipped'
      throw new Error(`github: list comments failed (${listRes.status})`)
    }
    const batch = (await listRes.json()) as GhComment[]
    // Match our own bot comment by the marker on its LAST line (buildPrCommentBody always ends with
    // it), so a marker embedded mid-body by a crafted test title can't redirect the upsert.
    existing = batch.find(c => c.user?.type === 'Bot' && !!c.body && c.body.trimEnd().endsWith(mark))
    if (existing || batch.length < 100)
      break
  }

  if ((!existing && !create) || (existing?.body && keep(existing.body)))
    return 'skipped'
  const target = existing
    ? { url: `${base}/issues/comments/${existing.id}`, method: 'PATCH' as const, outcome: 'updated' as const }
    : { url: `${base}/issues/${ctx.prNumber}/comments`, method: 'POST' as const, outcome: 'created' as const }

  const res = await fetchImpl(target.url, { method: target.method, headers, body: JSON.stringify({ body }) })
  if (!res.ok) {
    if (res.status === 403)
      return 'skipped'
    throw new Error(`github: ${target.outcome} comment failed (${res.status})`)
  }
  return target.outcome
}

// GITLAB_TOKEN is set on purpose, so a rejected call is a misconfiguration worth surfacing (unlike
// GitHub's read-only fork token): every failure throws.
async function upsertGitLabNote(ctx: GitLabMrContext, body: string, mark: string, create: boolean, keep: (existing: string) => boolean, fetchImpl: typeof globalThis.fetch): Promise<UpsertOutcome> {
  const headers = { 'private-token': ctx.token, 'content-type': 'application/json' }
  const base = `${ctx.apiUrl}/projects/${encodeURIComponent(ctx.projectId)}/merge_requests/${ctx.mrIid}`

  // The token may belong to a bot (project access token) or a person, so "our own note" is one
  // written by the token's user; a note from anyone else quoting the marker must not be hijacked.
  const meRes = await fetchImpl(`${ctx.apiUrl}/user`, { headers })
  if (!meRes.ok)
    throw new Error(`gitlab: token lookup failed (${meRes.status})`)
  const me = (await meRes.json()) as { id?: number }

  let existing: GlNote | undefined
  for (let page = 1; ; page++) {
    const listRes = await fetchImpl(`${base}/notes?per_page=100&page=${page}`, { headers })
    if (!listRes.ok)
      throw new Error(`gitlab: list notes failed (${listRes.status})`)
    const batch = (await listRes.json()) as GlNote[]
    existing = batch.find(n => !n.system && me.id != null && n.author?.id === me.id && !!n.body && n.body.trimEnd().endsWith(mark))
    if (existing || batch.length < 100)
      break
  }

  if ((!existing && !create) || (existing?.body && keep(existing.body)))
    return 'skipped'
  const target = existing
    ? { url: `${base}/notes/${existing.id}`, method: 'PUT' as const, outcome: 'updated' as const }
    : { url: `${base}/notes`, method: 'POST' as const, outcome: 'created' as const }

  const res = await fetchImpl(target.url, { method: target.method, headers, body: JSON.stringify({ body }) })
  if (!res.ok)
    throw new Error(`gitlab: ${target.outcome} note failed (${res.status})`)
  return target.outcome
}
