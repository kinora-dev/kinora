import type { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'

// Traces recorded from the demo suite by `pnpm demo-traces:generate`. The built seed runs
// from dist/scripts, so in the server image this resolves to dist/demo-traces/traces.
export const DEMO_TRACES_DIR = new URL('../demo-traces/traces/', import.meta.url)

export interface DemoTrace {
  file: string
  title: string
  line: number
  column: number
  status: 'passed' | 'failed'
  // Zip file name inside DEMO_TRACES_DIR.
  trace: string
  error?: { message: string, stack: string }
}

export interface LoadedDemoTrace extends DemoTrace {
  buf: Buffer
}

export async function loadDemoTraces(): Promise<LoadedDemoTrace[]> {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', DEMO_TRACES_DIR), 'utf8')) as DemoTrace[]
  return Promise.all(manifest.map(async t => ({ ...t, buf: await readFile(new URL(t.trace, DEMO_TRACES_DIR)) })))
}
