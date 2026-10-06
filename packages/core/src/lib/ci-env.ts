import type { CiMeta, GitMeta } from '../contracts/kinora'

// Git + CI metadata from the CI job's env, shared by the reporter and the CLI so both stamp a run
// the same way. env is injected so this module stays node-free (safe to bundle for the web).

export interface CiEnv {
  git?: GitMeta
  ci?: CiMeta
}

type Env = Record<string, string | undefined>

function gitOf(git: GitMeta): GitMeta | undefined {
  return git.sha || git.branch || git.repoUrl ? git : undefined
}

function detectGitLab(env: Env): CiEnv {
  // On a merge request pipeline the ref vars describe the MR, not a branch: the branch comes from
  // the MR source, and CI_COMMIT_SHA can be a throwaway merged-result commit, so prefer the source
  // head when GitLab exposes it.
  const git = gitOf({
    sha: env.CI_MERGE_REQUEST_SOURCE_BRANCH_SHA || env.CI_COMMIT_SHA || undefined,
    branch: env.CI_MERGE_REQUEST_SOURCE_BRANCH_NAME || env.CI_COMMIT_REF_NAME || undefined,
    baseBranch: env.CI_MERGE_REQUEST_TARGET_BRANCH_NAME || undefined,
    repoUrl: env.CI_PROJECT_URL || undefined,
  })
  return {
    git,
    ci: { provider: 'gitlab', runUrl: env.CI_PIPELINE_URL || undefined, runNumber: env.CI_PIPELINE_IID || undefined },
  }
}

function detectGitHub(env: Env): CiEnv {
  const repoUrl = env.GITHUB_SERVER_URL && env.GITHUB_REPOSITORY
    ? `${env.GITHUB_SERVER_URL}/${env.GITHUB_REPOSITORY}`
    : undefined
  const git = gitOf({
    sha: env.GITHUB_SHA,
    branch: env.GITHUB_REF_NAME,
    baseBranch: env.GITHUB_BASE_REF || undefined, // set on pull_request events
    repoUrl,
  })
  if (!env.GITHUB_ACTIONS)
    return { git }
  const runUrl = repoUrl && env.GITHUB_RUN_ID ? `${repoUrl}/actions/runs/${env.GITHUB_RUN_ID}` : undefined
  return { git, ci: { provider: 'github', runUrl, runNumber: env.GITHUB_RUN_NUMBER } }
}

export function detectCiEnv(env: Env): CiEnv {
  return env.GITLAB_CI ? detectGitLab(env) : detectGitHub(env)
}
