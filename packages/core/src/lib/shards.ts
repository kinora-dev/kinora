import type { NormTest } from '../contracts/kinora'

export const RERUN_ANNOTATION = 'kinora:rerun'

// A CI re-run of a shard replaces that shard's tests. A test that failed on an earlier attempt and
// passes now is stored as flaky, like a passing Playwright retry, so the re-run does not erase it.
export function mergeShardAttempt(previous: NormTest[], next: NormTest[], attempt: number): NormTest[] {
  const before = new Map(previous.map(t => [t.testKey, t]))
  return next.map((t) => {
    const prev = before.get(t.testKey)
    if (!prev || t.status !== 'expected' || (prev.status !== 'unexpected' && prev.status !== 'flaky'))
      return t
    return {
      ...t,
      status: 'flaky',
      retries: prev.retries + t.retries + 1,
      // The passing attempt carries no error; the failure is what explains the flake.
      errors: t.errors.length ? t.errors : prev.errors,
      annotations: [...t.annotations, { type: RERUN_ANNOTATION, description: `passed on re-run (attempt ${attempt})` }],
    }
  })
}

// The CI attempt a flaky test passed on, when it only passed on a re-run of its shard.
export function rerunAttemptOf(annotations: NormTest['annotations']): number | undefined {
  const a = annotations.find(x => x.type === RERUN_ANNOTATION)
  const attempt = Number(a?.description?.match(/attempt (\d+)/)?.[1])
  return Number.isInteger(attempt) ? attempt : undefined
}

export interface ShardSlot {
  current: number
  total: number
}

// A shard planned outside Playwright (`kinora shard` + `--test-list`) has no `config.shard`, so
// KINORA_SHARD=<current>/<total> names it for grouping.
export function shardFromEnv(env: Record<string, string | undefined>): ShardSlot | undefined {
  const m = env.KINORA_SHARD?.trim().match(/^(\d+)\/(\d+)$/)
  if (!m)
    return undefined
  const current = Number(m[1])
  const total = Number(m[2])
  return current >= 1 && current <= total ? { current, total } : undefined
}

export interface ShardGroup {
  groupKey: string
  attempt: number
}

// Identity of a CI run shared by all its shards, never by an attempt: a re-run of a failed shard
// keeps GITHUB_RUN_ID / CI_PIPELINE_ID, so it fills its slot in the same kinora run. `leg` tells
// apart matrix legs of one CI run that each shard the suite (otherwise their shard 1 would collide).
export function resolveShardGroup(
  env: Record<string, string | undefined>,
  opts: { groupKey?: string, leg?: string } = {},
): ShardGroup | undefined {
  const base = opts.groupKey
    ?? env.KINORA_GROUP_KEY
    ?? (env.GITHUB_RUN_ID ? `gh-${env.GITHUB_RUN_ID}` : env.CI_PIPELINE_ID ? `gl-${env.CI_PIPELINE_ID}` : undefined)
  if (!base)
    return undefined
  // GitLab has no attempt counter, but a retried job gets a new, higher job id.
  const attempt = Number(env.KINORA_ATTEMPT ?? env.GITHUB_RUN_ATTEMPT ?? env.CI_JOB_ID ?? 1)
  return {
    groupKey: opts.leg ? `${base}:${opts.leg}` : base,
    attempt: Number.isSafeInteger(attempt) && attempt >= 1 ? attempt : 1,
  }
}
