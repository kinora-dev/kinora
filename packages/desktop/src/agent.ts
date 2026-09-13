import type { Buffer } from 'node:buffer'
import type { ChildProcess } from 'node:child_process'
import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { augmentedPath } from './editor'

// The agent backend is the Claude Code CLI, spawned headless in the test's playwright
// config dir. It may read and edit files (acceptEdits) but not run commands: the app
// owns the loop (fix -> re-run -> watch), so Bash stays disabled and every change is
// reviewed as a git diff before the user keeps or reverts it.
const AGENT_ARGS = [
  '-p',
  '--output-format',
  'stream-json',
  '--verbose',
  '--permission-mode',
  'acceptEdits',
  '--disallowedTools',
  'Bash',
  '--max-turns',
  '50',
]
// Wall-clock cap: a wedged agent (network stall, credit prompt, runaway) dies on its
// own instead of relying on the user noticing and hitting Stop.
const AGENT_TIMEOUT_MS = 10 * 60 * 1000

// GUI-launched apps inherit a stripped PATH; augmentedPath() covers the classic system
// dirs, but `claude` usually lives in a per-user prefix (native installer, npm-global
// under a version manager, volta/bun/pnpm). Scan those explicitly.

const BIN_NAMES = process.platform === 'win32' ? ['claude.cmd', 'claude.exe', 'claude'] : ['claude']

// Version-manager roots hold one dir per node version; newest name first is a good
// proxy for "the one the user actually uses".
function versionManagerBins(root: string, sub = 'bin'): string[] {
  try {
    return fs.readdirSync(root)
      .sort()
      .reverse()
      .map(v => path.join(root, v, sub))
  }
  catch {
    return []
  }
}

export function claudeSearchDirs(home = os.homedir()): string[] {
  return [
    ...augmentedPath().split(path.delimiter),
    path.join(home, '.local', 'bin'), // Claude Code native installer
    path.join(home, '.claude', 'local'), // claude migrate-installer layout
    path.join(home, '.npm-global', 'bin'),
    path.join(home, '.volta', 'bin'),
    path.join(home, '.bun', 'bin'),
    path.join(home, '.local', 'share', 'pnpm'),
    '/home/linuxbrew/.linuxbrew/bin',
    ...versionManagerBins(path.join(home, '.nvm', 'versions', 'node')),
    ...versionManagerBins(path.join(home, '.local', 'share', 'fnm', 'node-versions'), path.join('installation', 'bin')),
    ...versionManagerBins(path.join(home, '.fnm', 'node-versions'), path.join('installation', 'bin')),
  ]
}

// First hit wins; PATH dirs come first so an explicit user install stays authoritative.
export function discoverClaude(dirs: string[]): { bin: string, dir: string } | null {
  for (const dir of dirs) {
    if (!dir)
      continue
    for (const name of BIN_NAMES) {
      const full = path.join(dir, name)
      try {
        if (fs.statSync(full).isFile())
          return { bin: full, dir }
      }
      catch {
        // keep scanning
      }
    }
  }
  return null
}

// The spawn target + the PATH the child gets. The binary's own dir is appended so an
// npm-installed `claude` (env-node shebang) finds its sibling `node`.
export function agentInvocation(): { bin: string, pathEnv: string } {
  const override = process.env.KINORA_AGENT_CMD
  if (override)
    return { bin: override, pathEnv: augmentedPath() }
  const found = discoverClaude(claudeSearchDirs())
  if (found)
    return { bin: found.bin, pathEnv: [augmentedPath(), found.dir].join(path.delimiter) }
  return { bin: 'claude', pathEnv: augmentedPath() }
}

export interface FixTarget {
  title: string
  absFile: string
  line: number
  projectName?: string
  status: string
  errors: string
  // Playwright's error-context markdown (test info + code frame + ARIA page snapshot),
  // pulled from the run's trace.zip when one is hosted.
  errorContext?: string | null
}

export interface AgentResult {
  ok: boolean
  error?: string
  // Claude Code session id (from the stream-json init event); lets a follow-up
  // run resume with full context instead of starting over.
  sessionId?: string
  // Spend and wall-clock of this turn (from the stream-json result event).
  costUsd?: number
  durationMs?: number
}

export function buildFixPrompt(t: FixTarget): string {
  return `This Playwright test is failing. Find the root cause and fix it.

Test: ${t.title}
File: ${t.absFile}:${t.line}
Playwright project: ${t.projectName || '(default)'}
Status: ${t.status}

Error:
${t.errors || '(no error captured)'}
${t.errorContext
  ? `
Context from the Playwright trace (page state at the moment of failure):

${t.errorContext}
`
  : ''}
Constraints:
- Fix the underlying cause: the code under test or the test itself, whichever is actually wrong.
- Do not run the test or any shell command; the app re-runs the test after your changes.
- Keep the change minimal and focused on this failure.`
}

// Follow-up prompt for a resumed session: the previous fix didn't turn the test green.
export function buildRetryPrompt(rerunOutput: string): string {
  return `The fix didn't make the test pass yet. Here is the output of re-running it locally:

${rerunOutput || '(no output captured)'}

Analyze what's still wrong and adjust the fix. Same constraints: don't run anything yourself, keep the change minimal.`
}

// Free-form user instruction for a resumed session ("also update the snapshot", ...).
export function buildFollowUpPrompt(message: string): string {
  return `${message}

(Same constraints as before: don't run the test or any shell command yourself; the app re-runs it after your changes.)`
}

// Session id lives on the stream-json init event.
export function extractSessionId(line: string): string | null {
  try {
    const evt = JSON.parse(line)
    return evt?.type === 'system' && evt.subtype === 'init' && typeof evt.session_id === 'string' ? evt.session_id : null
  }
  catch {
    return null
  }
}

// Cost + wall-clock live on the stream-json result event.
export function extractRunStats(line: string): { costUsd?: number, durationMs?: number } | null {
  try {
    const evt = JSON.parse(line)
    if (evt?.type !== 'result')
      return null
    return {
      costUsd: typeof evt.total_cost_usd === 'number' ? evt.total_cost_usd : undefined,
      durationMs: typeof evt.duration_ms === 'number' ? evt.duration_ms : undefined,
    }
  }
  catch {
    return null
  }
}

// One line of Claude Code's stream-json output -> human-readable panel text (null = skip).
export function formatAgentEvent(line: string): string | null {
  let evt: any
  try {
    evt = JSON.parse(line)
  }
  catch {
    // Not stream-json (startup noise, plain-text fallback): show as-is.
    return `${line}\n`
  }
  if (evt?.type === 'system' && evt.subtype === 'init')
    return `▸ agent started${evt.model ? ` (${evt.model})` : ''}\n`
  if (evt?.type === 'assistant') {
    const parts: string[] = []
    for (const block of evt.message?.content ?? []) {
      if (block.type === 'text' && block.text.trim())
        parts.push(`${block.text.trim()}\n`)
      else if (block.type === 'tool_use')
        parts.push(`▸ ${block.name} ${toolTarget(block.input)}\n`)
    }
    return parts.length ? parts.join('') : null
  }
  if (evt?.type === 'result') {
    return evt.is_error
      ? `✖ agent errored${typeof evt.result === 'string' ? `: ${evt.result}` : ''}\n`
      : `✔ agent finished\n`
  }
  // Tool results (type 'user') and other events stay out of the panel.
  return null
}

function toolTarget(input: unknown): string {
  if (!input || typeof input !== 'object')
    return ''
  const i = input as Record<string, unknown>
  const v = i.file_path ?? i.path ?? i.pattern ?? i.query ?? ''
  return typeof v === 'string' ? v : ''
}

export interface AgentRunOpts {
  // Resume a previous session (retry after a red re-run, or a user follow-up)
  // instead of starting fresh.
  resumeSessionId?: string
  // The prompt to send when resuming (buildRetryPrompt / buildFollowUpPrompt output).
  resumePrompt?: string
  // Wall-clock kill; defaults to AGENT_TIMEOUT_MS (override is for tests).
  timeoutMs?: number
}

// Spawn the agent in configDir, stream formatted output, resolve pass/fail on close.
export function startAgentFix(configDir: string, target: FixTarget, onOutput: (chunk: string) => void, onDone: (r: AgentResult) => void, opts: AgentRunOpts = {}): ChildProcess {
  const { bin, pathEnv } = agentInvocation()
  const args = opts.resumeSessionId ? [...AGENT_ARGS, '--resume', opts.resumeSessionId] : AGENT_ARGS
  const child = spawn(bin, args, {
    cwd: configDir,
    env: { ...process.env, PATH: pathEnv },
  })
  child.stdin?.end(opts.resumeSessionId ? opts.resumePrompt ?? '' : buildFixPrompt(target))

  const timeoutMs = opts.timeoutMs ?? AGENT_TIMEOUT_MS
  const timeoutHuman = timeoutMs >= 60_000 ? `${Math.round(timeoutMs / 60_000)} min` : `${Math.round(timeoutMs / 1000)}s`
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    onOutput(`✖ agent timed out after ${timeoutHuman}, stopping it\n`)
    child.kill()
  }, timeoutMs)

  let sessionId: string | undefined
  let stats: { costUsd?: number, durationMs?: number } = {}
  let buf = ''
  child.stdout?.on('data', (chunk: Buffer) => {
    buf += chunk.toString()
    const lines = buf.split('\n')
    buf = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.trim())
        continue
      sessionId ??= extractSessionId(line) ?? undefined
      stats = extractRunStats(line) ?? stats
      const text = formatAgentEvent(line)
      if (text)
        onOutput(text)
    }
  })
  child.stderr?.on('data', (chunk: Buffer) => onOutput(chunk.toString()))
  child.on('error', () => {
    clearTimeout(timer)
    onDone({ ok: false, error: `Claude Code CLI (\`${bin}\`) not found. Install it (npm install -g @anthropic-ai/claude-code) or point KINORA_AGENT_CMD at it.` })
  })
  child.on('close', (code, signal) => {
    clearTimeout(timer)
    if (timedOut)
      onDone({ ok: false, error: `agent timed out after ${timeoutHuman}`, sessionId, ...stats })
    else if (signal)
      onDone({ ok: false, error: 'cancelled', sessionId, ...stats })
    else
      onDone({ ok: code === 0, error: code === 0 ? undefined : `agent exited with code ${code}`, sessionId, ...stats })
  })
  return child
}

// Changes are attributed to the agent by diffing `git status` before vs after, so a
// user's pre-existing uncommitted work is never shown as the agent's, and Revert only
// ever touches paths the agent newly dirtied.

export interface GitSnapshot {
  root: string
  dirty: Set<string>
}

export interface AgentChange {
  path: string
  untracked: boolean
}

function git(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // `color.ui = always` colours output even when stdout is not a tty, which would
    // render the reviewed diff as ANSI escape codes. color.diff has to be cleared
    // too: it overrides color.ui for diff output.
    execFile('git', ['-c', 'color.ui=false', '-c', 'color.diff=false', ...args], { cwd, maxBuffer: 32 * 1024 * 1024 }, (err, stdout) => {
      if (err) {
        // Keep partial stdout on the error: `diff --no-index` exits 1 *with* the diff.
        (err as NodeJS.ErrnoException & { stdout?: string }).stdout = stdout
        reject(err)
      }
      else {
        resolve(stdout)
      }
    })
  })
}

// `git status --porcelain -z -uall` -> map of root-relative path -> XY status.
export function parsePorcelainZ(out: string): Map<string, string> {
  const entries = new Map<string, string>()
  const tokens = out.split('\0').filter(Boolean)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const xy = t.slice(0, 2)
    entries.set(t.slice(3), xy)
    // Staged renames/copies carry the origin path as an extra NUL-separated token.
    if (xy[0] === 'R' || xy[0] === 'C')
      i++
  }
  return entries
}

export async function gitSnapshot(dir: string): Promise<GitSnapshot | null> {
  try {
    const root = (await git(['rev-parse', '--show-toplevel'], dir)).trim()
    const out = await git(['status', '--porcelain=v1', '-z', '-uall'], root)
    return { root, dirty: new Set(parsePorcelainZ(out).keys()) }
  }
  catch {
    // Not a git repo: the agent still works, but there's no diff/revert safety net.
    return null
  }
}

// Paths dirtied by the agent = dirty now, not dirty before the run.
export function newlyChanged(before: Set<string>, after: Map<string, string>): AgentChange[] {
  const changes: AgentChange[] = []
  for (const [p, xy] of after) {
    if (!before.has(p))
      changes.push({ path: p, untracked: xy === '??' })
  }
  return changes
}

export async function collectAgentDiff(snap: GitSnapshot): Promise<{ changes: AgentChange[], diff: string }> {
  const out = await git(['status', '--porcelain=v1', '-z', '-uall'], snap.root)
  const changes = newlyChanged(snap.dirty, parsePorcelainZ(out))
  const tracked = changes.filter(c => !c.untracked).map(c => c.path)
  let diff = tracked.length ? await git(['diff', '--', ...tracked], snap.root) : ''
  for (const c of changes.filter(c => c.untracked)) {
    // `--no-index` exits 1 when files differ; that's the diff, not an error.
    diff += await git(['diff', '--no-index', '--', '/dev/null', c.path], snap.root).catch((err: any) =>
      typeof err?.stdout === 'string' ? err.stdout : '')
  }
  return { changes, diff }
}

export async function revertAgentChanges(snap: GitSnapshot, changes: AgentChange[]): Promise<void> {
  const tracked = changes.filter(c => !c.untracked).map(c => c.path)
  if (tracked.length)
    await git(['checkout', '--', ...tracked], snap.root)
  for (const c of changes.filter(c => c.untracked))
    fs.rmSync(path.join(snap.root, c.path), { force: true })
}
