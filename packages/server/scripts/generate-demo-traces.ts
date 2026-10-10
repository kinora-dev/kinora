import type { DemoTrace } from './demo-traces'
import { execFile } from 'node:child_process'
import { copyFile, cp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { stripAnsi } from '@kinora/core'
import { DEMO_TRACES_DIR } from './demo-traces'

// Runs the demo suite (demo-traces/suite) and stores one trace.zip per test plus a
// manifest in demo-traces/traces, which seed-market uploads for the matching seeded tests.
// Some tests fail on purpose: their real error lands in the manifest so the dashboard
// shows the same failure as the trace.

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const suite = path.join(root, 'demo-traces/suite')
const out = fileURLToPath(DEMO_TRACES_DIR)
const playwrightBin = path.join(root, 'node_modules/.bin/playwright')

interface JsonError { message?: string, location?: { file: string, line: number, column: number } }
interface JsonResult { status: string, error?: JsonError, attachments: { name: string, path?: string }[] }
interface JsonSpec { title: string, file: string, line: number, column: number, tests: { results: JsonResult[] }[] }
interface JsonSuite { specs?: JsonSpec[], suites?: JsonSuite[] }

// Copied out of the repo so trace paths are neutral (no home directory inside the zips).
const tmpRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp'
const tmp = path.join(tmpRoot, 'kinora-demo-traces')

await rm(tmp, { force: true, recursive: true })
await cp(suite, tmp, { recursive: true })
await writeFile(path.join(tmp, 'package.json'), '{ "type": "module" }\n')
await symlink(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir')

try {
  // Exits 1 because of the deliberate failures; the JSON report says what actually ran.
  await execFileAsync(playwrightBin, ['test'], { cwd: tmp }).catch(() => {})
  const report = JSON.parse(await readFile(path.join(tmp, 'results.json'), 'utf8')) as { suites: JsonSuite[] }

  await rm(out, { force: true, recursive: true })
  await mkdir(out, { recursive: true })
  const traces: DemoTrace[] = []
  for (const spec of specsOf(report.suites)) {
    const result = spec.tests[0].results.at(-1)!
    if (result.status !== 'passed' && result.status !== 'failed')
      throw new Error(`${spec.file} › ${spec.title}: unexpected status ${result.status}`)
    const trace = result.attachments.find(a => a.name === 'trace')?.path
    if (!trace)
      throw new Error(`${spec.file} › ${spec.title}: no trace recorded`)

    const name = `${path.basename(spec.file, '.spec.ts')}--${spec.title.replace(/\W+/g, '-').toLowerCase()}.zip`
    await copyFile(trace, path.join(out, name))
    traces.push({
      file: spec.file,
      title: spec.title,
      line: spec.line,
      column: spec.column,
      status: result.status,
      trace: name,
      error: result.status === 'failed' ? errorOf(spec, result.error) : undefined,
    })
    console.log(`${result.status.padEnd(6)} ${spec.file} › ${spec.title}`)
  }
  await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(traces, null, 2)}\n`)
  console.log(`Wrote ${traces.length} traces to ${path.relative(process.cwd(), out)}`)
}
finally {
  await rm(tmp, { force: true, recursive: true })
}

function* specsOf(suites: JsonSuite[]): Generator<JsonSpec> {
  for (const s of suites) {
    yield* s.specs ?? []
    yield* specsOf(s.suites ?? [])
  }
}

// Same shape the reporter uploads: Playwright's message (no code frame) and where it threw.
function errorOf(spec: JsonSpec, error: JsonError | undefined): DemoTrace['error'] {
  const at = error?.location
  return {
    message: stripAnsi(error?.message ?? 'Error').trim(),
    stack: at ? `at ${spec.file}:${at.line}:${at.column}` : `at ${spec.file}:${spec.line}:${spec.column}`,
  }
}
