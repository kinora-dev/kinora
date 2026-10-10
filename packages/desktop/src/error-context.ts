import { Buffer } from 'node:buffer'
import { unzipSync } from 'fflate'

// Playwright attaches an `error-context` markdown blob (test info + error + code frame +
// ARIA page snapshot) to failing tests, shaped for an LLM. It isn't hosted as its own
// artifact, but it travels inside the trace.zip: an `after` event in a `*.trace` JSONL
// names its zip entry: `file` (trace format v9+) or a `sha1` pointing at `resources/<sha1>` (older traces).

// The trace itself stays small; the cap only guards against pathological zips.
const MAX_ZIP_BYTES = 200 * 1024 * 1024
const FETCH_TIMEOUT_MS = 20_000

export function extractErrorContext(zip: Uint8Array): string | null {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(zip)
  }
  catch {
    return null
  }
  const entry = findErrorContextEntry(files)
  if (!entry)
    return null
  const resource = files[entry]
  return resource ? stripInstructions(Buffer.from(resource).toString('utf8')) : null
}

function findErrorContextEntry(files: Record<string, Uint8Array>): string | null {
  for (const [name, data] of Object.entries(files)) {
    if (!name.endsWith('.trace'))
      continue
    for (const line of Buffer.from(data).toString('utf8').split('\n')) {
      if (!line.includes('"error-context"'))
        continue
      try {
        const evt = JSON.parse(line)
        const att = (evt.attachments as { name: string, file?: string, sha1?: string }[] | undefined)?.find(a => a.name === 'error-context')
        if (att?.file)
          return att.file
        if (att?.sha1)
          return `resources/${att.sha1}`
      }
      catch {
        // Malformed line: keep scanning.
      }
    }
  }
  return null
}

// The blob opens with its own "# Instructions" section (explain, be concise, snippet
// only) which contradicts the fix prompt; keep the factual sections from "# Test info" on.
export function stripInstructions(md: string): string {
  const idx = md.indexOf('# Test info')
  return (idx > 0 ? md.slice(idx) : md).trim()
}

// Download the hosted trace.zip and pull the error-context out of it. Best-effort:
// any failure (offline, oversized, no attachment) degrades to a prompt without it.
export async function fetchErrorContext(traceUrl: string): Promise<string | null> {
  try {
    const res = await fetch(traceUrl, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
    if (!res.ok)
      return null
    const len = Number(res.headers.get('content-length') || 0)
    if (len > MAX_ZIP_BYTES)
      return null
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.byteLength > MAX_ZIP_BYTES)
      return null
    return extractErrorContext(buf)
  }
  catch {
    return null
  }
}
