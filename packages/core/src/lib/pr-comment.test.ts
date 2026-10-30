import type { Counts } from '../contracts/kinora'
import { describe, expect, it, vi } from 'vitest'
import { buildPrCommentBody, flakyTestsOf, postPrComment, resolvePrContext } from './pr-comment'
import { RERUN_ANNOTATION } from './shards'

const prEnv = {
  GITHUB_TOKEN: 'tok',
  GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REPOSITORY: 'acme/app',
  GITHUB_REF: 'refs/pull/42/merge',
}

const mrEnv = {
  GITLAB_CI: 'true',
  GITLAB_TOKEN: 'gltok',
  CI_API_V4_URL: 'https://gitlab.acme.com/api/v4',
  CI_PROJECT_ID: '77',
  CI_MERGE_REQUEST_IID: '5',
}

const counts: Counts = { total: 10, expected: 8, unexpected: 1, flaky: 1, skipped: 0 }
const green: Counts = { total: 10, expected: 10, unexpected: 0, flaky: 0, skipped: 0 }

describe('resolvePrContext', () => {
  it('resolves owner/repo/prNumber from a pull_request ref', () => {
    expect(resolvePrContext(prEnv, () => undefined)).toMatchObject({ owner: 'acme', repo: 'app', prNumber: 42, apiUrl: 'https://api.github.com' })
  })

  it('prefers the event payload PR number over the ref', () => {
    const ctx = resolvePrContext({ ...prEnv, GITHUB_EVENT_PATH: '/evt', GITHUB_REF: 'refs/heads/x' }, () => JSON.stringify({ pull_request: { number: 7 } }))
    expect(ctx).toMatchObject({ provider: 'github', prNumber: 7 })
  })

  it('honors GITHUB_API_URL for GHES', () => {
    expect(resolvePrContext({ ...prEnv, GITHUB_API_URL: 'https://ghe.acme.com/api/v3' }, () => undefined)?.apiUrl).toBe('https://ghe.acme.com/api/v3')
  })

  it('returns null off a PR (push event)', () => {
    expect(resolvePrContext({ ...prEnv, GITHUB_EVENT_NAME: 'push' }, () => undefined)).toBeNull()
  })

  it('rejects pull_request_target (privileged fork-content token)', () => {
    expect(resolvePrContext({ ...prEnv, GITHUB_EVENT_NAME: 'pull_request_target' }, () => undefined)).toBeNull()
  })

  it('returns null without a token', () => {
    expect(resolvePrContext({ ...prEnv, GITHUB_TOKEN: undefined }, () => undefined)).toBeNull()
  })

  it('resolves a GitLab merge request pipeline with GITLAB_TOKEN', () => {
    expect(resolvePrContext(mrEnv, () => undefined)).toEqual({ provider: 'gitlab', token: 'gltok', apiUrl: 'https://gitlab.acme.com/api/v4', projectId: '77', mrIid: 5, isShard: false })
  })

  it('targets the project the MR lives in for a fork MR', () => {
    expect(resolvePrContext({ ...mrEnv, CI_MERGE_REQUEST_PROJECT_ID: '12' }, () => undefined)).toMatchObject({ projectId: '12' })
  })

  it('returns null on GitLab without a token or outside a merge request pipeline', () => {
    expect(resolvePrContext({ ...mrEnv, GITLAB_TOKEN: undefined }, () => undefined)).toBeNull()
    expect(resolvePrContext({ ...mrEnv, CI_MERGE_REQUEST_IID: undefined }, () => undefined)).toBeNull()
  })
})

describe('buildPrCommentBody', () => {
  it('includes counts, regression, links, and the project marker', () => {
    const body = buildPrCommentBody({
      projectSlug: 'web',
      projectName: 'Web',
      runUrl: 'https://app.kinora.dev/x',
      counts,
      regression: { base: 'base-branch', newlyFailing: [{ testKey: 'k', title: 'login', file: 'a.spec.ts' }], newlyFlaky: [], fixed: 2 },
    })
    expect(body).toContain('**1 failed**')
    expect(body).toContain('1 newly failing** vs base branch')
    expect(body).toContain('`login`') // titles are code-spanned to neutralize @mentions/#refs/markers
    expect(body).toContain('2 fixed vs base branch')
    expect(body).toContain('https://app.kinora.dev/x')
    expect(body).toContain('<!-- kinora:pr:web -->')
  })

  it('names an environment incident instead of comparing the run', () => {
    const body = buildPrCommentBody({
      projectSlug: 'web',
      projectName: 'Web',
      counts,
      regression: { base: 'base-branch', newlyFailing: [{ testKey: 'k', title: 'login', file: 'a.spec.ts' }], newlyFlaky: [], fixed: 0 },
      incident: { reason: '9 of 10 tests failed, 9 of them navigating or connecting to staging.example.test (connection refused).' },
    })
    expect(body).toContain('⚠️ **kinora** · Web · environment incident')
    expect(body).toContain('**Environment incident, not counted.** 9 of 10 tests failed')
    expect(body).not.toContain('newly failing')
  })

  it('truncates a long failing list', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ testKey: `k${i}`, title: `t${i}`, file: 'f' }))
    const body = buildPrCommentBody({ projectSlug: 'web', projectName: 'Web', counts, regression: { base: 'previous-run', newlyFailing: many, newlyFlaky: [], fixed: 0 } })
    expect(body).toContain('and 5 more')
  })

  it('names the newly flaky tests, then the run\'s other flaky tests', () => {
    const t = (testKey: string) => ({ testKey, title: `test ${testKey}`, file: 'cart.spec.ts' })
    const body = buildPrCommentBody({
      projectSlug: 'web',
      projectName: 'Web',
      counts: { total: 10, expected: 7, unexpected: 0, flaky: 3, skipped: 0 },
      regression: { base: 'base-branch', newlyFailing: [], newlyFlaky: [t('a')], fixed: 0 },
      flaky: [t('a'), t('b'), t('c')],
    })
    expect(body).toContain('⚠️')
    expect(body).toContain('**1 newly flaky** vs base branch:\n- `cart.spec.ts` › `test a`')
    // The new one is not listed twice.
    expect(body).toContain('**2 more flaky**, already flaky on the base branch:\n- `cart.spec.ts` › `test b`\n- `cart.spec.ts` › `test c`')
    expect(body.indexOf('test a')).toBeLessThan(body.indexOf('test b'))
  })

  it('names every flaky test when there is no baseline, capped like the failures', () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ testKey: `k${i}`, title: `t${i}`, file: 'f.ts' }))
    const body = buildPrCommentBody({ projectSlug: 'web', projectName: 'Web', counts, flaky: many })
    expect(body).toContain('**20 flaky**:')
    expect(body).toContain('…and 5 more')
    expect(buildPrCommentBody({ projectSlug: 'web', projectName: 'Web', counts, regression: { base: 'none', newlyFailing: [], newlyFlaky: [], fixed: 0 }, flaky: many.slice(0, 1) }))
      .toContain('**1 flaky**:')
  })

  it('adds no flaky section to a run without flaky tests', () => {
    const body = buildPrCommentBody({ projectSlug: 'web', projectName: 'Web', counts: green, regression: { base: 'base-branch', newlyFailing: [], newlyFlaky: [], fixed: 0 }, flaky: [] })
    expect(body).not.toContain('flaky**')
    expect(body).toContain('No change vs base branch.')
  })

  it('keeps a flaky test title from breaking out of its code span', () => {
    const body = buildPrCommentBody({ projectSlug: 'web', projectName: 'Web', counts, flaky: [{ testKey: 'k', title: '`@maintainer`\nnext', file: 'a.ts' }] })
    expect(body).toContain('`‘@maintainer‘ next`')
  })

  it('marks the flaky tests that only passed on a re-run of their shard', () => {
    const flaky = flakyTestsOf([
      { testKey: 'a', title: 'pays', file: 'cart.spec.ts', status: 'flaky', annotations: [{ type: RERUN_ANNOTATION, description: 'passed on re-run (attempt 2)' }] },
      { testKey: 'b', title: 'ships', file: 'cart.spec.ts', status: 'flaky', annotations: [] },
    ])
    expect(flaky).toEqual([
      { testKey: 'a', title: 'pays', file: 'cart.spec.ts', rerunAttempt: 2 },
      { testKey: 'b', title: 'ships', file: 'cart.spec.ts' },
    ])
    const body = buildPrCommentBody({
      projectSlug: 'web',
      projectName: 'Web',
      counts: { total: 10, expected: 8, unexpected: 0, flaky: 2, skipped: 0 },
      // The re-run mark also applies to a new flake, listed from the regression.
      regression: { base: 'base-branch', newlyFailing: [], newlyFlaky: [{ testKey: 'a', title: 'pays', file: 'cart.spec.ts' }], fixed: 0 },
      flaky,
    })
    expect(body).toContain('- `cart.spec.ts` › `pays` · passed on re-run (attempt 2)\n')
    expect(body).toContain('- `cart.spec.ts` › `ships`\n')
  })

  it('shows a sharded run missing shards as in progress, without comparing it', () => {
    const body = buildPrCommentBody({
      projectSlug: 'web',
      projectName: 'Web',
      counts: { total: 4, expected: 4, unexpected: 0, flaky: 0, skipped: 0 },
      regression: { base: 'base-branch', newlyFailing: [], newlyFlaky: [], fixed: 3 },
      shards: { runId: 'r1', landed: 2, total: 4 },
    })
    expect(body).toContain('⏳ **kinora** · Web · 2 of 4 shards landed')
    expect(body).toContain('`4/4 passed` · **0 failed** · 0 flaky · 0 skipped so far')
    expect(body).not.toContain('fixed')
    expect(body.split('\n').slice(-2)).toEqual(['<!-- kinora:shards:r1:2 -->', '<!-- kinora:pr:web -->'])

    const done = buildPrCommentBody({ projectSlug: 'web', projectName: 'Web', counts: green, shards: { runId: 'r1', landed: 4, total: 4 } })
    expect(done).toContain('✅ **kinora** · Web\n')
    expect(done).not.toContain('so far')
  })

  it('lists the flaky tests of a run from its tests', () => {
    const tests = [
      { testKey: 'a', title: 'a', file: 'f.ts', status: 'flaky' as const },
      { testKey: 'b', title: 'b', file: 'f.ts', status: 'expected' as const },
      { testKey: 'c', title: 'c', file: 'f.ts', status: 'unexpected' as const },
    ]
    expect(flakyTestsOf(tests)).toEqual([{ testKey: 'a', title: 'a', file: 'f.ts' }])
  })

  it('links each listed test to the run narrowed to it', () => {
    const key = 'tests/cart (v2).spec.ts::cart › adds an item::chromium'
    const body = buildPrCommentBody({
      projectSlug: 'web',
      projectName: 'Web',
      counts,
      runUrl: 'https://app.kinora.dev/projects/web/runs/r1',
      regression: { base: 'base-branch', newlyFailing: [{ testKey: key, title: 'adds an item', file: 'tests/cart (v2).spec.ts' }], newlyFlaky: [], fixed: 0 },
      flaky: [{ testKey: 'k2', title: 'pays', file: 'pay.spec.ts' }],
    })
    // Encoded key, parentheses included, so they can't end the markdown link.
    expect(body).toContain('- [`tests/cart (v2).spec.ts` › `adds an item`](https://app.kinora.dev/projects/web/runs/r1?test=tests%2Fcart%20%28v2%29.spec.ts%3A%3Acart%20%E2%80%BA%20adds%20an%20item%3A%3Achromium)')
    expect(body).toContain('- [`pay.spec.ts` › `pays`](https://app.kinora.dev/projects/web/runs/r1?test=k2)')
  })

  it('lists tests as plain text without a run URL', () => {
    const body = buildPrCommentBody({ projectSlug: 'web', projectName: 'Web', counts, flaky: [{ testKey: 'k', title: 'pays', file: 'pay.spec.ts' }] })
    expect(body).toContain('- `pay.spec.ts` › `pays`')
    expect(body).not.toContain('?test=')
  })

  it('keys the marker by label for matrix legs', () => {
    expect(buildPrCommentBody({ projectSlug: 'web', projectName: 'Web', label: 'node20', counts })).toContain('<!-- kinora:pr:web:node20 -->')
  })

  it('neutralizes a malicious test title (mention/marker inside a code span)', () => {
    const body = buildPrCommentBody({
      projectSlug: 'web',
      projectName: 'Web',
      counts,
      regression: { base: 'base-branch', newlyFailing: [{ testKey: 'k', title: '@maintainer <!-- kinora:pr:web -->', file: 'a.ts' }], newlyFlaky: [], fixed: 0 },
    })
    // The title is wrapped in backticks, so its @mention/marker cannot escape into rendered markdown.
    expect(body).toContain('`@maintainer <!-- kinora:pr:web -->`')
  })
})

describe('postPrComment', () => {
  const ctx = { provider: 'github' as const, token: 't', apiUrl: 'https://api.github.com', owner: 'a', repo: 'r', prNumber: 1, isShard: false }
  const input = { projectSlug: 'web', projectName: 'Web', counts }

  it('creates a comment when none carries the marker', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await postPrComment(ctx, input, 'always', fetch as unknown as typeof globalThis.fetch)).toBe('created')
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('/issues/1/comments'), expect.objectContaining({ method: 'POST' }))
  })

  it('updates our own bot comment carrying the marker on its last line', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 9, body: 'summary\n<!-- kinora:pr:web -->', user: { type: 'Bot' } }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await postPrComment(ctx, input, 'always', fetch as unknown as typeof globalThis.fetch)).toBe('updated')
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('/issues/comments/9'), expect.objectContaining({ method: 'PATCH' }))
  })

  it('does not hijack a human comment that quotes the marker', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 5, body: 'look: <!-- kinora:pr:web -->', user: { type: 'User' } }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await postPrComment(ctx, input, 'always', fetch as unknown as typeof globalThis.fetch)).toBe('created')
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('/issues/1/comments'), expect.objectContaining({ method: 'POST' }))
  })

  it('skips on a per-shard run', async () => {
    expect(await postPrComment({ ...ctx, isShard: true }, input, 'always', vi.fn() as unknown as typeof globalThis.fetch)).toBe('skipped')
  })

  it('leaves a newer view of the same sharded run alone, and replaces an older one or another run', async () => {
    const existing = (body: string) => vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 9, body, user: { type: 'Bot' } }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    const shardsAt = (runId: string, landed: number) => ({ ...input, shards: { runId, landed, total: 4 } })
    const post = (fetch: ReturnType<typeof existing>, landed: number, runId = 'r1') =>
      postPrComment(ctx, shardsAt(runId, landed), 'always', fetch as unknown as typeof globalThis.fetch)
    const comment = (runId: string, landed: number) => buildPrCommentBody({ ...input, shards: { runId, landed, total: 4 } })

    // A slow shard 2 after shard 3 completed the run.
    const slow = existing(comment('r1', 4))
    expect(await post(slow, 3)).toBe('skipped')
    expect(slow).toHaveBeenCalledTimes(1)
    expect(await post(existing(comment('r1', 2)), 3)).toBe('updated')
    // A re-run of a shard after completion still refreshes the comment.
    expect(await post(existing(comment('r1', 4)), 4)).toBe('updated')
    // A new push: a new run replaces the comment of the previous one.
    expect(await post(existing(comment('r0', 4)), 1, 'r2')).toBe('updated')
  })

  it('posts no new comment for a green run under the on-failure policy', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => [] })
    expect(await postPrComment(ctx, { ...input, counts: green }, 'on-failure', fetch as unknown as typeof globalThis.fetch)).toBe('skipped')
    expect(fetch).toHaveBeenCalledTimes(1) // the lookup, no POST
  })

  it('still updates the comment of an earlier failing run when a green run comes in under on-failure', async () => {
    // A fix, or a re-run that passes: the red comment must not stay up.
    const fetch = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 9, body: '❌ failed\n<!-- kinora:pr:web -->', user: { type: 'Bot' } }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await postPrComment(ctx, { ...input, counts: green }, 'on-failure', fetch as unknown as typeof globalThis.fetch)).toBe('updated')
    const [url, init] = fetch.mock.calls.at(-1)!
    expect(url).toContain('/issues/comments/9')
    expect(JSON.parse(init.body).body).toContain('✅')
  })
})

describe('postPrComment on GitLab', () => {
  const ctx = { provider: 'gitlab' as const, token: 't', apiUrl: 'https://gitlab.com/api/v4', projectId: '77', mrIid: 5, isShard: false }
  const input = { projectSlug: 'web', projectName: 'Web', counts }
  const me = { ok: true, json: async () => ({ id: 3 }) }
  const base = 'https://gitlab.com/api/v4/projects/77/merge_requests/5/notes'

  it('creates a note when none carries the marker', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(me)
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await postPrComment(ctx, input, 'always', fetch as unknown as typeof globalThis.fetch)).toBe('created')
    expect(fetch).toHaveBeenLastCalledWith(base, expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ 'private-token': 't' }) }))
  })

  it('updates the note written by the token user', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(me)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 9, body: 'summary\n<!-- kinora:pr:web -->', author: { id: 3 } }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await postPrComment(ctx, input, 'always', fetch as unknown as typeof globalThis.fetch)).toBe('updated')
    expect(fetch).toHaveBeenLastCalledWith(`${base}/9`, expect.objectContaining({ method: 'PUT' }))
  })

  it('does not hijack a note from another user that quotes the marker', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(me)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 5, body: 'look\n<!-- kinora:pr:web -->', author: { id: 8 } }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await postPrComment(ctx, input, 'always', fetch as unknown as typeof globalThis.fetch)).toBe('created')
    expect(fetch).toHaveBeenLastCalledWith(base, expect.objectContaining({ method: 'POST' }))
  })

  it('updates an earlier note for a green run under on-failure, and creates none', async () => {
    const withNote = vi.fn()
      .mockResolvedValueOnce(me)
      .mockResolvedValueOnce({ ok: true, json: async () => [{ id: 9, body: '❌ failed\n<!-- kinora:pr:web -->', author: { id: 3 } }] })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await postPrComment(ctx, { ...input, counts: green }, 'on-failure', withNote as unknown as typeof globalThis.fetch)).toBe('updated')
    expect(withNote).toHaveBeenLastCalledWith(`${base}/9`, expect.objectContaining({ method: 'PUT' }))

    const without = vi.fn()
      .mockResolvedValueOnce(me)
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
    expect(await postPrComment(ctx, { ...input, counts: green }, 'on-failure', without as unknown as typeof globalThis.fetch)).toBe('skipped')
    expect(without).toHaveBeenCalledTimes(2) // token lookup + notes, no POST
  })

  it('surfaces a rejected token instead of skipping silently', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: false, status: 401 })
    await expect(postPrComment(ctx, input, 'always', fetch as unknown as typeof globalThis.fetch)).rejects.toThrow('gitlab: token lookup failed (401)')
  })

  it('surfaces a token without write access', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(me)
      .mockResolvedValueOnce({ ok: true, json: async () => [] })
      .mockResolvedValueOnce({ ok: false, status: 403 })
    await expect(postPrComment(ctx, input, 'always', fetch as unknown as typeof globalThis.fetch)).rejects.toThrow('gitlab: created note failed (403)')
  })

  it('skips on a per-shard run', async () => {
    expect(await postPrComment({ ...ctx, isShard: true }, input, 'always', vi.fn() as unknown as typeof globalThis.fetch)).toBe('skipped')
  })
})
