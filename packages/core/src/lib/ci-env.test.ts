import { describe, expect, it } from 'vitest'
import { detectCiEnv } from './ci-env'

const ghEnv = {
  GITHUB_ACTIONS: 'true',
  GITHUB_SHA: 'abc123',
  GITHUB_REF_NAME: 'main',
  GITHUB_SERVER_URL: 'https://github.com',
  GITHUB_REPOSITORY: 'acme/app',
  GITHUB_RUN_ID: '42',
  GITHUB_RUN_NUMBER: '7',
}

const glEnv = {
  GITLAB_CI: 'true',
  CI_COMMIT_SHA: 'def456',
  CI_COMMIT_REF_NAME: 'main',
  CI_PROJECT_URL: 'https://gitlab.com/acme/app',
  CI_PIPELINE_URL: 'https://gitlab.com/acme/app/-/pipelines/901',
  CI_PIPELINE_IID: '12',
}

describe('detectCiEnv', () => {
  it('returns nothing outside CI', () => {
    expect(detectCiEnv({})).toEqual({ git: undefined })
  })

  it('reads git + ci from GitHub Actions', () => {
    expect(detectCiEnv(ghEnv)).toEqual({
      git: { sha: 'abc123', branch: 'main', baseBranch: undefined, repoUrl: 'https://github.com/acme/app' },
      ci: { provider: 'github', runUrl: 'https://github.com/acme/app/actions/runs/42', runNumber: '7' },
    })
  })

  it('reads the base branch on a GitHub pull_request and drops the empty value on a push', () => {
    expect(detectCiEnv({ ...ghEnv, GITHUB_BASE_REF: 'main' }).git?.baseBranch).toBe('main')
    expect(detectCiEnv({ ...ghEnv, GITHUB_BASE_REF: '' }).git?.baseBranch).toBeUndefined()
  })

  it('reads git + ci from a GitLab branch pipeline', () => {
    expect(detectCiEnv(glEnv)).toEqual({
      git: { sha: 'def456', branch: 'main', baseBranch: undefined, repoUrl: 'https://gitlab.com/acme/app' },
      ci: { provider: 'gitlab', runUrl: 'https://gitlab.com/acme/app/-/pipelines/901', runNumber: '12' },
    })
  })

  it('reads the source and target branches on a GitLab merge request pipeline', () => {
    const { git } = detectCiEnv({
      ...glEnv,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feat/login',
      CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'main',
    })
    expect(git).toMatchObject({ sha: 'def456', branch: 'feat/login', baseBranch: 'main' })
  })

  it('prefers the source head over the merged-result commit on GitLab', () => {
    const { git } = detectCiEnv({
      ...glEnv,
      CI_MERGE_REQUEST_SOURCE_BRANCH_NAME: 'feat/login',
      CI_MERGE_REQUEST_SOURCE_BRANCH_SHA: 'head789',
    })
    expect(git?.sha).toBe('head789')
  })

  it('picks GitLab over stray GITHUB_* vars', () => {
    expect(detectCiEnv({ ...ghEnv, ...glEnv }).ci?.provider).toBe('gitlab')
  })
})
