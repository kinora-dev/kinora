---
title: PR comments
description: Post a summary comment on the GitHub pull request or GitLab merge request straight from CI.
---

On a pull request run, kinora can post (and keep updating) a summary comment on the PR:
pass/fail counts, tests newly failing versus the base branch, the flaky tests by name, and a link
to the run. It works on
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

The comment lists tests **newly failing versus the PR's base branch**, then the **flaky tests**
(passed on a retry): the newly flaky ones first, then those already flaky on the base branch, so a
reviewer sees which tests flaked before merging. Each test links to the run, narrowed to that test,
with its trace one click away. Long lists are capped at 15 tests. This needs the base
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
- **Sharded runs**: when shards upload on their own, each shard updates the one comment with the
  shards landed so far ("2 of 4 shards landed"), until the last one shows the whole run. A test
  that only passed on a re-run of its shard is marked "passed on re-run". With `merge-reports`
  (blob report), the merged run posts the comment. See [Sharded runs](/guides/reporter/#sharded-runs).
- **Matrix builds sharing a PR**: give each leg its own label so they keep separate comments -
  reporter `prComment: { label: 'node20' }`, CLI `--pr-label node20`.
- **Green runs**: `policy: 'on-failure'` (reporter) / `--pr-policy on-failure` (CLI) posts no
  comment when the run passes, but still updates the comment an earlier failing run left on the
  PR, so a fix or a re-run that passes doesn't leave it red. The default posts always.

## How the comment stays single

kinora tags its comment with a hidden marker keyed by project (and label, if set), finds its own
previous comment on the PR, and edits it in place. Re-running the job updates the same comment
rather than adding a new one. On GitLab, "its own" means a note written by the user behind
`GITLAB_TOKEN`, so keep using the same token to keep a single comment.

## Commit status (GitHub)

kinora can also set a `kinora / <project>` commit status on the pull request, next to your CI
jobs in the checks list. It is red only when the PR breaks something: a test failing on the PR
that passed on the base branch. A test already failing on the base branch, or a flaky one, leaves
it green.

```
✓ kinora / web-app   No new failures vs main · 1 already failing · 2 flaky   Details
✗ kinora / web-app   2 newly failing vs main                                  Details
```

**Details** opens the run in kinora. Turn it on alongside the comment or on its own:

```ts
reporter: [['@kinora/reporter', { project: { slug: 'web-app' }, prStatus: true }]]
```

```bash
npx @kinora/cli upload results.json --project web-app --pr-status
```

The job needs to write statuses:

```yaml
permissions:
  statuses: write
```

### Block merges on regressions only

Mark `kinora / web-app` as a required status check in the branch protection rules, and let the
Playwright job itself continue on error. A PR then can't merge when it makes a test fail, while a
test that was already broken on the base branch or a flaky one no longer blocks it.

```yaml
- run: npx playwright test
  continue-on-error: true # the kinora status is the required check
```

### How the status reads the run

- **Without a baseline** (the base branch has no run yet), the status falls back to the run's own
  result: red if any test failed.
- **Sharded runs** show as pending ("2 of 4 shards landed") until the last shard lands.
- **An environment incident** sets it red: nothing was tested, so the PR should not merge on it.
  Re-run once the app is back.
- **Matrix legs** get one status each from their label: `kinora / web-app (firefox)`. It reuses
  `prComment.label` / `--pr-label`, or set `prStatus: { label }`.
- **Fork PRs** are skipped, as for the comment: their `GITHUB_TOKEN` is read-only.
- **GitLab** is not supported yet: the option does nothing there.
