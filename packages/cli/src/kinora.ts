#!/usr/bin/env node
import type { AttachmentKind } from '@kinora/core'
import { existsSync, readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { DEFAULT_KINORA_URL, detectCiEnv, IngestError, postPrComment, resolvePrContext } from '@kinora/core'
import { parseAttachmentKinds } from './args'
import { importReports } from './import'
import { uploadReport } from './upload'

const USAGE = `kinora - upload a Playwright json report to a kinora server

Usage:
  kinora upload <results.json> --project <slug> [options]
  kinora import <dir>          --project <slug> [options]   # bulk-import every *.json (historical, no traces)

Required:
  --project <slug>      Target project slug

Auth (or via env KINORA_TOKEN / KINORA_URL):
  --token <token>       Project API token
  --url <url>           kinora server base URL (default: hosted cloud; set for self-host)

Options:
  --name <name>         Project display name (default: slug)
  --git-sha <sha>
  --git-branch <branch>
  --git-repo-url <url>  Remote URL (https://github.com/org/repo) to link shas to commits
  --ci-provider <name>
  --ci-run-url <url>
  --ci-run-number <n>
  (In GitHub Actions and GitLab CI, git + ci metadata auto-detect from the env; flags override.)
  --pr-comment          Post/update a summary on the GitHub PR (needs GITHUB_TOKEN + pull-requests: write)
                        or the GitLab MR (needs a GITLAB_TOKEN variable with the api scope)
  --pr-label <label>    Distinguish matrix legs that share one PR
  --pr-policy <policy>  always (default) | on-failure (skip the comment on green runs)
  --concurrency <n>     Parallel uploads for bulk import (default 6)
  --upload-attachments <kinds>
                        Comma-separated: trace, snapshot (both default), video, screenshot.
                        snapshot = images of a failed screenshot assertion.
                        Add video/screenshot when your suite runs without traces
                        (with tracing on they already ride inside the trace.zip).
  -h, --help`

function attachmentKinds(raw: string | undefined): AttachmentKind[] | undefined {
  try {
    return parseAttachmentKinds(raw)
  }
  catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
}

function fail(msg: string): never {
  console.error(`error: ${msg}\n`)
  console.error(USAGE)
  process.exit(1)
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      'project': { type: 'string' },
      'name': { type: 'string' },
      'token': { type: 'string' },
      'url': { type: 'string' },
      'git-sha': { type: 'string' },
      'git-branch': { type: 'string' },
      'git-repo-url': { type: 'string' },
      'ci-provider': { type: 'string' },
      'ci-run-url': { type: 'string' },
      'ci-run-number': { type: 'string' },
      'git-base-branch': { type: 'string' },
      'pr-comment': { type: 'boolean' },
      'pr-label': { type: 'string' },
      'pr-policy': { type: 'string' },
      'concurrency': { type: 'string' },
      'upload-attachments': { type: 'string' },
      'help': { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(USAGE)
    return
  }

  if (!values.project)
    fail('--project <slug> is required')

  const url = values.url ?? process.env.KINORA_URL ?? DEFAULT_KINORA_URL
  const token = values.token ?? process.env.KINORA_TOKEN
  if (!token)
    fail('--token or KINORA_TOKEN is required')

  // Bulk import: kinora import <dir> - backfill every results.json under a directory.
  if (positionals[0] === 'import') {
    const dir = positionals[1]
    if (!dir)
      fail('pass a directory: kinora import <dir> --project <slug>')
    const { imported, failed } = await importReports({
      dir,
      project: { slug: values.project, name: values.name },
      url,
      token,
      concurrency: values.concurrency ? Number(values.concurrency) : undefined,
    })
    console.log(`imported ${imported} runs into ${values.project}${failed ? ` (${failed} skipped)` : ''}`)
    return
  }

  // Single upload: kinora upload <file> (or kinora <file>).
  const args = positionals[0] === 'upload' ? positionals.slice(1) : positionals
  if (args.length !== 1)
    fail('pass exactly one Playwright results.json path')
  const reportFile = args[0]
  if (!existsSync(reportFile))
    fail(`report not found: ${reportFile}`)

  // git + ci: explicit flags override, else auto-detect from the CI env (like the reporter).
  const detected = detectCiEnv(process.env)
  const sha = values['git-sha'] ?? detected.git?.sha
  const branch = values['git-branch'] ?? detected.git?.branch
  const baseBranch = values['git-base-branch'] ?? detected.git?.baseBranch
  const repoUrl = values['git-repo-url'] ?? detected.git?.repoUrl
  const git = sha || branch || repoUrl || baseBranch ? { sha, branch, baseBranch, repoUrl } : undefined

  const ciProvider = values['ci-provider'] ?? detected.ci?.provider
  const ciRunUrl = values['ci-run-url'] ?? detected.ci?.runUrl
  const ciRunNumber = values['ci-run-number'] ?? detected.ci?.runNumber
  const ci = ciProvider || ciRunUrl || ciRunNumber ? { provider: ciProvider, runUrl: ciRunUrl, runNumber: ciRunNumber } : undefined

  const raw: unknown = JSON.parse(await readFile(reportFile, 'utf8'))
  const res = await uploadReport(raw, {
    project: { slug: values.project, name: values.name },
    url,
    token,
    git,
    ci,
    regression: !!values['pr-comment'],
    uploadAttachments: attachmentKinds(values['upload-attachments']),
  })

  console.log(`uploaded ${res.tests} tests to ${values.project} (run ${res.runId})`)

  // Best-effort PR/MR comment (GitHub: the job's GITHUB_TOKEN; GitLab: GITLAB_TOKEN). Never fails the upload.
  if (values['pr-comment']) {
    try {
      const ctx = resolvePrContext(process.env, (p) => {
        try {
          return readFileSync(p, 'utf8')
        }
        catch {
          return undefined
        }
      })
      if (ctx) {
        const policy = values['pr-policy'] === 'on-failure' ? 'on-failure' : 'always'
        const outcome = await postPrComment(ctx, {
          projectSlug: values.project,
          projectName: values.name ?? values.project,
          label: values['pr-label'],
          runUrl: res.runUrl,
          ciRunUrl: ci?.runUrl,
          counts: res.counts,
          regression: res.regression,
        }, policy)
        if (outcome !== 'skipped')
          console.log(`PR comment ${outcome}`)
      }
    }
    catch (err) {
      console.warn(`warning: PR comment failed: ${err instanceof Error ? err.message : err}`)
    }
  }
}

main().catch((err) => {
  if (err instanceof IngestError)
    console.error(`error: ${err.message}`)
  else
    console.error(err)
  process.exit(1)
})
