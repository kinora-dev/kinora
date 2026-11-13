import type { QuarantinedTest } from '@kinora/core'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { createReadClient, isListableTitle, testListEntry } from '@kinora/core'

export interface QuarantineListOptions {
  project: string
  url: string
  token: string
  out: string
  fetch?: typeof globalThis.fetch
}

export interface QuarantineList {
  file: string
  listed: number
  // Quarantined but not written: no stored result to name it, or a title a list line cannot name.
  skipped: { testKey: string, why: string }[]
}

// A reason can span lines: kept on one, so no part of it reads as a list entry.
function describe(q: QuarantinedTest): string {
  const parts = [q.reason?.replace(/\s+/g, ' ').trim(), q.expiresAt && `until ${q.expiresAt.slice(0, 10)}`].filter(Boolean)
  return parts.length ? `# ${parts.join(', ')}\n` : ''
}

export function quarantineHeader(project: string): string {
  return `# kinora quarantine for ${project}: run the suite with --test-list-invert, these with --test-list\n`
}

export function quarantineListFile(quarantines: QuarantinedTest[], project: string): Omit<QuarantineList, 'file'> & { content: string } {
  const skipped: QuarantineList['skipped'] = []
  let content = quarantineHeader(project)
  let listed = 0
  for (const q of quarantines) {
    if (!q.test) {
      skipped.push({ testKey: q.testKey, why: 'no stored result names it any more' })
      continue
    }
    if (!isListableTitle(q.test.titlePath)) {
      skipped.push({ testKey: q.testKey, why: 'its title cannot be named in a test list (contains "›" or surrounding spaces)' })
      continue
    }
    content += `${describe(q)}${testListEntry(q.test)}\n`
    listed++
  }
  return { listed, skipped, content }
}

// Writes the project's quarantined tests as a Playwright test list.
export async function writeQuarantineList(opts: QuarantineListOptions): Promise<QuarantineList> {
  const client = createReadClient({ baseUrl: opts.url, token: opts.token, fetch: opts.fetch })
  const { content, listed, skipped } = quarantineListFile(await client.getQuarantines(opts.project), opts.project)
  await mkdir(dirname(opts.out), { recursive: true })
  await writeFile(opts.out, content)
  return { file: opts.out, listed, skipped }
}
