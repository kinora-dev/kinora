import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildIngestRun, createIngestClient, describeRetry } from '@kinora/core'

export interface ImportOptions {
  dir: string
  project: { slug: string, name?: string }
  url: string
  token: string
  concurrency?: number
  baseUrls?: string[]
}

// Backfill every results.json under a directory as historical runs (no traces, no alerts).
export async function importReports(opts: ImportOptions): Promise<{ imported: number, failed: number }> {
  const entries = await readdir(opts.dir, { recursive: true })
  const files = entries.filter(f => f.endsWith('.json')).map(f => join(opts.dir, f))
  if (files.length === 0)
    return { imported: 0, failed: 0 }

  const client = createIngestClient({ baseUrl: opts.url, token: opts.token, backfill: true, onRetry: info => console.warn(`  ${describeRetry(info)}`) })
  const slug = opts.project.slug
  const name = opts.project.name ?? slug
  const concurrency = Math.max(1, opts.concurrency ?? 6)

  let imported = 0
  let failed = 0

  for (let i = 0; i < files.length; i += concurrency) {
    const chunk = files.slice(i, i + concurrency)
    await Promise.all(chunk.map(async (file) => {
      try {
        const raw: unknown = JSON.parse(await readFile(file, 'utf8'))
        await client.uploadRun(buildIngestRun(raw, { project: { slug, name }, baseUrls: opts.baseUrls }))
        imported++
      }
      catch (err) {
        failed++
        console.warn(`  skip ${file}: ${err instanceof Error ? err.message : String(err)}`)
      }
    }))
    console.log(`  ${Math.min(i + concurrency, files.length)}/${files.length}`)
  }

  return { imported, failed }
}
