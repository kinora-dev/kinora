---
title: PR comments
description: Post a summary comment on the GitHub pull request or GitLab merge request straight from CI.
---

On a pull request run, kinora can post (and keep updating) a summary comment on the PR:
pass/fail counts, tests newly failing versus the base branch, and a link to the run. It works on
GitHub pull requests and GitLab merge requests, and it posts from the CI job itself, so **no
credentials are stored in kinora**. It works the same on cloud and self-host.

Both upload paths support it: the [reporter](/guides/reporter/) and the [CLI](/guides/cli/).

## Reporter

```ts
reporter: [['@kinora/reporter', { project: { slug: 'web-app' }, prComment: true }]]
```

## CLI

```bash
npx @kinora/cli upload results.json --project web-app --pr-comment
```

## GitHub: required workflow permission

The comment is posted with the job's ambient `GITHUB_TOKEN`, which must be granted write access
to PRs:

```yaml
# in your workflow job:
permissions:
  pull-requests: write # required for the PR comment
steps:
  - run: npx playwright test
    env:
      KINORA_TOKEN: ${{ secrets.KINORA_TOKEN }}
```

## GitLab: required token

GitLab's job token can read merge request notes but not write them, so the comment needs a token
of its own. Create a **project access token** (or a group or personal one) with the `api` scope
and a role that can comment (Reporter or above), then expose it to the job as a CI/CD variable
named `GITLAB_TOKEN`. Mask it, and leave **Protected** off unless your MR branches are protected,
otherwise the variable is missing on merge request pipelines.

The job must run in a **merge request pipeline**, which is where GitLab provides the MR number:

```yaml
e2e:
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
  script:
    - npx playwright test # KINORA_TOKEN and GITLAB_TOKEN are CI/CD variables
```

Self-managed instances work as is: the API URL comes from `CI_API_V4_URL`.

## Regression vs the base branch

The comment lists tests **newly failing versus the PR's base branch**. This needs the base
branch name, which auto-detects from `GITHUB_BASE_REF` on a `pull_request` run and from the MR
target branch on a GitLab merge request pipeline (or set it explicitly: reporter
`git.baseBranch`, CLI `--git-base-branch`). kinora compares the PR run's tests against the latest
run on the base branch to compute what regressed.

## Edge cases

- **Fork PRs are skipped on GitHub.** `GITHUB_TOKEN` is read-only on pull requests from forks, so
  the comment can't be posted there and is silently skipped.
- **Fork MRs on GitLab** run in the fork, where `GITLAB_TOKEN` isn't defined, so nothing is
  posted.
- **A rejected `GITLAB_TOKEN`** (expired, wrong scope) logs a warning and never fails the upload.
- **Sharded runs**: shard with `merge-reports` (blob report) so one merged run posts one comment.
  Per-shard runs are skipped.
- **Matrix builds sharing a PR**: give each leg its own label so they keep separate comments -
  reporter `prComment: { label: 'node20' }`, CLI `--pr-label node20`.
- **Green runs**: `policy: 'on-failure'` (reporter) / `--pr-policy on-failure` (CLI) skips the
  comment when the run passes. The default posts always.

## How the comment stays single

kinora tags its comment with a hidden marker keyed by project (and label, if set), finds its own
previous comment on the PR, and edits it in place. Re-running the job updates the same comment
rather than adding a new one. On GitLab, "its own" means a note written by the user behind
`GITLAB_TOKEN`, so keep using the same token to keep a single comment.
