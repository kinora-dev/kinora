import type { Counts } from '../contracts/kinora'
import type { GitHubPrContext } from './pr-comment'
import type { PrStatusInput } from './pr-status'
import { describe, expect, it, vi } from 'vitest'
import { buildPrStatus, postPrStatus } from './pr-status'

const red: Counts = { total: 10, expected: 7, unexpected: 2, flaky: 1, skipped: 0 }
const green: Counts = { total: 10, expected: 9, unexpected: 0, flaky: 1, skipped: 0 }
const newlyFailing = [{ testKey: 'k', title: 'login', file: 'a.spec.ts' }]

describe('buildPrStatus', () => {
  const input: PrStatusInput = { projectSlug: 'web', counts: red, baseBranch: 'main' }

  it('fails on tests newly failing vs the base branch', () => {
    expect(buildPrStatus({ ...input, regression: { base: 'base-branch', newlyFailing, newlyFlaky: [], fixed: 0 } }))
      .toEqual({ context: 'kinora / web', state: 'failure', description: '1 newly failing vs main' })
  })

  it('passes when the failures were already failing on the base branch', () => {
    expect(buildPrStatus({ ...input, regression: { base: 'base-branch', newlyFailing: [], newlyFlaky: [], fixed: 0 } }))
      .toMatchObject({ state: 'success', description: 'No new failures vs main · 2 already failing · 1 flaky' })
  })

  it('names the previous run when that is the baseline', () => {
    expect(buildPrStatus({ ...input, regression: { base: 'previous-run', newlyFailing, newlyFlaky: [], fixed: 0 } }).description).toBe('1 newly failing vs previous run')
  })

  it('falls back to the run\'s own result without a baseline', () => {
    expect(buildPrStatus(input)).toMatchObject({ state: 'failure', description: '2 failed, no baseline to compare against' })
    expect(buildPrStatus({ ...input, counts: green, regression: { base: 'none', newlyFailing: [], newlyFlaky: [], fixed: 0 } }))
      .toMatchObject({ state: 'success', description: '10/10 passed · 1 flaky' })
  })

  it('stays pending until every shard landed', () => {
    expect(buildPrStatus({ ...input, regression: { base: 'base-branch', newlyFailing, newlyFlaky: [], fixed: 0 }, shards: { runId: 'r1', landed: 2, total: 4 } }))
      .toMatchObject({ state: 'pending', description: '2 of 4 shards landed' })
  })

  it('fails an environment incident, which tested nothing', () => {
    expect(buildPrStatus({ ...input, counts: green, incident: { reason: 'app down' } }).state).toBe('failure')
  })

  it('keys the context by label for matrix legs', () => {
    expect(buildPrStatus({ ...input, label: 'firefox' }).context).toBe('kinora / web (firefox)')
  })
})

describe('postPrStatus', () => {
  const ctx: GitHubPrContext = { provider: 'github', token: 't', apiUrl: 'https://api.github.com', owner: 'a', repo: 'r', prNumber: 1, headSha: 'head', isShard: false }
  const runUrl = 'https://app.kinora.dev/projects/web/runs/r1'
  const input: PrStatusInput = { projectSlug: 'web', counts: green, runUrl }
  const asFetch = (f: ReturnType<typeof vi.fn>) => f as unknown as typeof globalThis.fetch

  it('posts the verdict on the PR head commit, linking the run', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await postPrStatus(ctx, input, asFetch(fetch))).toBe('posted')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('https://api.github.com/repos/a/r/statuses/head')
    expect(JSON.parse(init.body)).toEqual({ state: 'success', context: 'kinora / web', description: '10/10 passed · 1 flaky', target_url: runUrl })
  })

  it('skips a shard run, GitLab, a context without the head commit, and a read-only fork token', async () => {
    const none = vi.fn()
    expect(await postPrStatus({ ...ctx, isShard: true }, input, asFetch(none))).toBe('skipped')
    expect(await postPrStatus({ ...ctx, headSha: undefined }, input, asFetch(none))).toBe('skipped')
    expect(await postPrStatus({ provider: 'gitlab', token: 't', apiUrl: 'x', projectId: '1', mrIid: 1, isShard: false }, input, asFetch(none))).toBe('skipped')
    expect(none).not.toHaveBeenCalled()
    expect(await postPrStatus(ctx, input, asFetch(vi.fn().mockResolvedValueOnce({ ok: false, status: 403 })))).toBe('skipped')
  })

  it('throws on any other API error', async () => {
    await expect(postPrStatus(ctx, input, asFetch(vi.fn().mockResolvedValueOnce({ ok: false, status: 500 })))).rejects.toThrow('500')
  })

  it('leaves a newer view of the same sharded run alone, and replaces an older one or another run', async () => {
    const current = (statuses: object[]) => vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => statuses })
      .mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    const pending = (landed: number, url = runUrl) => ({ context: 'kinora / web', state: 'pending', description: `${landed} of 4 shards landed`, target_url: url })
    const post = (fetch: ReturnType<typeof vi.fn>, landed: number) => postPrStatus(ctx, { ...input, shards: { runId: 'r1', landed, total: 4 } }, asFetch(fetch))

    // A slow shard 2 after the run completed, or after shard 3.
    expect(await post(current([{ context: 'kinora / web', state: 'success', target_url: runUrl }]), 2)).toBe('skipped')
    expect(await post(current([pending(3)]), 2)).toBe('skipped')
    expect(await post(current([pending(1)]), 2)).toBe('posted')
    // Another context, or a previous run on the same commit, does not hold it back.
    expect(await post(current([{ ...pending(3), context: 'kinora / api' }]), 2)).toBe('posted')
    expect(await post(current([{ context: 'kinora / web', state: 'success', target_url: 'https://app.kinora.dev/projects/web/runs/r0' }]), 2)).toBe('posted')
  })

  it('posts the final verdict of a sharded run without looking up the current one', async () => {
    const fetch = vi.fn().mockResolvedValueOnce({ ok: true, json: async () => ({}) })
    expect(await postPrStatus(ctx, { ...input, shards: { runId: 'r1', landed: 4, total: 4 } }, asFetch(fetch))).toBe('posted')
    expect(fetch).toHaveBeenCalledTimes(1)
  })
})
