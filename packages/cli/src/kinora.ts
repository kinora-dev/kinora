#!/usr/bin/env node
import type { AttachmentKind } from '@kinora/core'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import process from 'node:process'
import { parseArgs } from 'node:util'
import { DEFAULT_KINORA_URL, detectCiEnv, IngestError, postPrComment, resolvePrContext, resolveShardGroup, shardFromEnv } from '@kinora/core'
import { parseAttachmentKinds, parseBaseUrls } from './args'
import { importReports } from './import'
import { quarantineHeader, writeQuarantineList } from './quarantine'
import { formatShardPlan, loadDurations, parseGranularity, parseShardTotal, writeShardPlan } from './shard'
import { uploadReport } from './upload'

const USAGE = `kinora - upload a Playwright json report to a kinora server

Usage:
  kinora upload <results.json> --project <slug> [options]
  kinora import <dir>          --project <slug> [options]   # bulk-import every *.json (historical, no traces)
  kinora shard --list <list.json> --total <n> (--project <slug> | --from-report <results.json>) [options]
  kinora quarantine --project <slug> [--out quarantine.txt]

Shard (balance CI shards by past durations; run each with \`playwright test --test-list <out-dir>/shard-<i>.txt\`
and KINORA_SHARD=<i>/<n> so its upload joins the others):
  --list <file>         Output of \`playwright test --list --reporter=json\`
  --total <n>           Number of shards
  --from-report <file>  Read durations from a previous Playwright JSON report instead of kinora
  --runs <n>            Newest kinora runs to take durations from (default 30)
  --out-dir <dir>       Where shard-<i>.txt files go (default: shards)
  --granularity <g>     file (default: a file stays on one shard) | test (split files, for fullyParallel suites)

Quarantine (the tests quarantined in the dashboard, as a Playwright test list):
  --out <file>          Where the list goes (default: quarantine.txt). Skip them in the blocking job with
                        \`playwright test --test-list-invert <file>\`, run them in a non-blocking one with --test-list

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
  --pr-policy <policy>  always (default) | on-failure (no new comment on green runs)
  --group-key <key>     Sharded report (--shard): the run its shards are assembled into
                        (default: env KINORA_GROUP_KEY, then GITHUB_RUN_ID / CI_PIPELINE_ID)
  --no-group            Upload a sharded report as a run of its own
  (A shard run with --test-list records no shard: set KINORA_SHARD=<i>/<n> so it is grouped.)
  --base-url <url>      The app's baseURL, repeatable (one per Playwright project), or env
                        KINORA_BASE_URL (comma-separated). A JSON report does not carry it, and it
                        tells an environment incident on the app's host from a third-party outage
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

function baseUrlsOf(flags: string[] | undefined): string[] | undefined {
  try {
    return parseBaseUrls(flags, process.env.KINORA_BASE_URL)
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

interface ShardFlags {
  'project'?: string
  'list'?: string
  'total'?: string
  'from-report'?: string
  'runs'?: string
  'out-dir'?: string
  'granularity'?: string
}

// A bad token or an unknown project is a setup mistake to fix, not an outage CI should ride out. A
// server too old for the route also answers 404, and is ridden out.
function failOnSetupError(err: unknown): void {
  if (err instanceof IngestError && (err.status === 401 || err.status === 403 || (err.status === 404 && err.message === 'Project not found')))
    fail(err.message)
}

async function readJson(file: string, flag: string): Promise<unknown> {
  if (!existsSync(file))
    fail(`${flag} file not found: ${file}`)
  return JSON.parse(await readFile(file, 'utf8'))
}

async function shard(values: ShardFlags, url: string, token: string | undefined): Promise<void> {
  if (!values.list)
    fail('--list <file> is required')
  let total: number
  let granularity: ReturnType<typeof parseGranularity>
  try {
    total = parseShardTotal(values.total)
    granularity = parseGranularity(values.granularity)
  }
  catch (err) {
    fail(err instanceof Error ? err.message : String(err))
  }
  const list = await readJson(values.list, '--list')

  let durations = new Map<string, number>()
  if (values['from-report']) {
    durations = await loadDurations({ kind: 'report', report: await readJson(values['from-report'], '--from-report') })
  }
  else {
    if (!values.project || !token)
      fail('pass --project and a token (--token or KINORA_TOKEN), or --from-report <results.json>')
    // A shard plan without history is still a valid split, so kinora being unreachable must not fail CI.
    try {
      durations = await loadDurations({ kind: 'kinora', project: values.project, url, token, runs: values.runs ? Number(values.runs) : undefined })
    }
    catch (err) {
      failOnSetupError(err)
      console.warn(`warning: could not read durations from kinora, splitting by test count: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const plan = await writeShardPlan({ list, total, outDir: values['out-dir'] ?? 'shards', granularity, durations })
  console.log(formatShardPlan(plan))
  if (plan.shards.some(s => !s.tests))
    console.warn('warning: some shards are empty; run them with --pass-with-no-tests or lower --total')
}

async function quarantine(project: string | undefined, out: string, url: string, token: string | undefined): Promise<void> {
  if (!project)
    fail('--project <slug> is required')
  if (!token)
    fail('--token or KINORA_TOKEN is required')
  try {
    const res = await writeQuarantineList({ project, url, token, out })
    console.log(`${res.listed} quarantined tests written to ${res.file}`)
    for (const s of res.skipped)
      console.warn(`warning: ${s.testKey} is quarantined but not listed: ${s.why}`)
  }
  catch (err) {
    failOnSetupError(err)
    // An empty list quarantines nothing: CI then runs the whole suite as it would without kinora.
    console.warn(`warning: could not read quarantines from kinora, none applied: ${err instanceof Error ? err.message : String(err)}`)
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, quarantineHeader(project))
  }
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
      'group-key': { type: 'string' },
      'no-group': { type: 'boolean' },
      'base-url': { type: 'string', multiple: true },
      'list': { type: 'string' },
      'total': { type: 'string' },
      'from-report': { type: 'string' },
      'runs': { type: 'string' },
      'out-dir': { type: 'string' },
      'granularity': { type: 'string' },
      'out': { type: 'string' },
      'help': { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(USAGE)
    return
  }

  const url = values.url ?? process.env.KINORA_URL ?? DEFAULT_KINORA_URL
  const token = values.token ?? process.env.KINORA_TOKEN

  if (positionals[0] === 'shard') {
    await shard(values, url, token)
    return
  }

  if (positionals[0] === 'quarantine') {
    await quarantine(values.project, values.out ?? 'quarantine.txt', url, token)
    return
  }

  if (!values.project)
    fail('--project <slug> is required')
  if (!token)
    fail('--token or KINORA_TOKEN is required')
  const baseUrls = baseUrlsOf(values['base-url'])

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
      baseUrls,
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
    baseUrls,
    group: values['no-group'] ? undefined : resolveShardGroup(process.env, { groupKey: values['group-key'], leg: values['pr-label'] }),
    shard: shardFromEnv(process.env),
  })

  const shards = res.shardProgress ? `, ${res.shardProgress.landed} of ${res.shardProgress.total} shards` : ''
  console.log(`uploaded ${res.tests} tests to ${values.project} (run ${res.runId}${shards})`)
  if (res.incident)
    console.warn(`warning: environment incident, not counted: ${res.incident.reason}`)

  // Best-effort PR/MR comment (GitHub: the job's GITHUB_TOKEN; GitLab: GITLAB_TOKEN). Never fails the upload.
  // A grouped shard updates the comment with the shards landed so far; a server that predates
  // grouping sends no progress, and that shard is then a partial run that must not comment.
  if (values['pr-comment'] && !(res.grouped && !res.shardProgress)) {
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
          flaky: res.flaky,
          ...(res.shardProgress && { shards: { runId: res.runId, ...res.shardProgress } }),
          ...(res.incident && { incident: res.incident }),
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
