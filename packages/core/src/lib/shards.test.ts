import type { NormTest } from '../contracts/kinora'
import { describe, expect, it } from 'vitest'
import { mergeShardAttempt, RERUN_ANNOTATION, resolveShardGroup, shardFromEnv } from './shards'

function makeTest(over: Partial<NormTest> & { testKey: string, status: NormTest['status'] }): NormTest {
  return {
    title: over.testKey,
    titlePath: [over.testKey],
    file: 'f.ts',
    line: 1,
    column: 1,
    projectName: 'chromium',
    ok: over.status !== 'unexpected',
    duration: 100,
    retries: 0,
    tags: [],
    annotations: [],
    errors: [],
    attachments: [],
    ...over,
  }
}

describe('mergeShardAttempt', () => {
  it('stores a test that failed on the earlier attempt and passes now as flaky', () => {
    const previous = [makeTest({ testKey: 'a', status: 'unexpected', retries: 1, errors: [{ message: 'boom' }] })]
    const [merged] = mergeShardAttempt(previous, [makeTest({ testKey: 'a', status: 'expected' })], 2)
    expect(merged.status).toBe('flaky')
    expect(merged.retries).toBe(2)
    expect(merged.errors).toEqual([{ message: 'boom' }])
    expect(merged.annotations).toEqual([{ type: RERUN_ANNOTATION, description: 'passed on re-run (attempt 2)' }])
  })

  it('keeps a flake from the earlier attempt', () => {
    const [merged] = mergeShardAttempt([makeTest({ testKey: 'a', status: 'flaky' })], [makeTest({ testKey: 'a', status: 'expected' })], 2)
    expect(merged.status).toBe('flaky')
  })

  it('takes the new attempt as is otherwise', () => {
    const previous = [
      makeTest({ testKey: 'still-failing', status: 'unexpected' }),
      makeTest({ testKey: 'broke', status: 'expected' }),
      makeTest({ testKey: 'stable', status: 'expected' }),
    ]
    const next = [
      makeTest({ testKey: 'still-failing', status: 'unexpected' }),
      makeTest({ testKey: 'broke', status: 'unexpected' }),
      makeTest({ testKey: 'stable', status: 'expected' }),
      makeTest({ testKey: 'new', status: 'expected' }),
    ]
    expect(mergeShardAttempt(previous, next, 2)).toEqual(next)
  })
})

describe('resolveShardGroup', () => {
  it('keys a GitHub run by its run id and takes the attempt from GITHUB_RUN_ATTEMPT', () => {
    expect(resolveShardGroup({ GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '3' })).toEqual({ groupKey: 'gh-42', attempt: 3 })
  })

  it('keys a GitLab pipeline by its id and orders attempts by job id', () => {
    expect(resolveShardGroup({ CI_PIPELINE_ID: '7', CI_JOB_ID: '1001' })).toEqual({ groupKey: 'gl-7', attempt: 1001 })
  })

  it('prefers the explicit key, then KINORA_GROUP_KEY, and appends the matrix leg', () => {
    const env = { KINORA_GROUP_KEY: 'from-env', GITHUB_RUN_ID: '42' }
    expect(resolveShardGroup(env, { groupKey: 'mine', leg: 'firefox' })?.groupKey).toBe('mine:firefox')
    expect(resolveShardGroup(env)?.groupKey).toBe('from-env')
  })

  it('returns nothing outside CI without a key, and falls back to attempt 1 on junk', () => {
    expect(resolveShardGroup({})).toBeUndefined()
    expect(resolveShardGroup({ GITHUB_RUN_ID: '1', GITHUB_RUN_ATTEMPT: 'x' })?.attempt).toBe(1)
  })
})

describe('shardFromEnv', () => {
  it('reads KINORA_SHARD as current/total', () => {
    expect(shardFromEnv({ KINORA_SHARD: '2/4' })).toEqual({ current: 2, total: 4 })
    expect(shardFromEnv({ KINORA_SHARD: ' 1/1 ' })).toEqual({ current: 1, total: 1 })
  })

  it('ignores a missing or malformed value', () => {
    expect(shardFromEnv({})).toBeUndefined()
    expect(shardFromEnv({ KINORA_SHARD: '5/4' })).toBeUndefined()
    expect(shardFromEnv({ KINORA_SHARD: '0/4' })).toBeUndefined()
    expect(shardFromEnv({ KINORA_SHARD: '2' })).toBeUndefined()
  })
})
