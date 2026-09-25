import type { Entry } from '@zip.js/zip.js'
import type { ActionPhase } from '../src/core/isomorphic/trace/trace'
import type { TraceLoaderBackend } from '../src/core/isomorphic/trace/traceLoader'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { BlobReader, BlobWriter, TextWriter, ZipReader } from '@zip.js/zip.js'
import { describe, expect, it } from 'vitest'
import { TraceLoader } from '../src/core/isomorphic/trace/traceLoader'

const fixtures = path.join(import.meta.dirname, 'fixtures')

// Reads a trace.zip from a local file instead of over HTTP (the sw backend uses
// zip.js HttpReader; here we feed bytes directly so the engine runs in Node).
class FileZipBackend implements TraceLoaderBackend {
  private entries = new Map<string, Entry>()

  private constructor() {}

  static async open(file: string): Promise<FileZipBackend> {
    const backend = new FileZipBackend()
    const buf = await readFile(file)
    const reader = new ZipReader(new BlobReader(new Blob([buf])))
    for (const entry of await reader.getEntries())
      backend.entries.set(entry.filename, entry)
    return backend
  }

  isLive(): boolean { return false }
  async entryNames(): Promise<string[]> { return [...this.entries.keys()] }
  async hasEntry(name: string): Promise<boolean> { return this.entries.has(name) }

  async readText(name: string): Promise<string | undefined> {
    const entry = this.entries.get(name)
    if (!entry?.getData)
      return
    const writer = new TextWriter()
    await entry.getData(writer)
    return writer.getData()
  }

  async readBlob(name: string): Promise<Blob | undefined> {
    const entry = this.entries.get(name)
    if (!entry?.getData)
      return
    const writer = new BlobWriter()
    await entry.getData(writer)
    return writer.getData()
  }
}

async function loadTrace(fixture: string): Promise<TraceLoader> {
  const backend = await FileZipBackend.open(path.join(fixtures, fixture))
  const loader = new TraceLoader()
  await loader.load(backend)
  return loader
}

describe('vendored trace engine', () => {
  for (const fixture of ['test-trace1.zip', 'test-trace2.zip']) {
    it(`parses ${fixture} into a context model`, async () => {
      const loader = await loadTrace(fixture)

      expect(loader.contextEntries.length).toBeGreaterThan(0)
      const totalActions = loader.contextEntries.reduce((n, c) => n + c.actions.length, 0)
      const totalResources = loader.contextEntries.reduce((n, c) => n + c.resources.length, 0)
      const snapshotFrames = loader.storage().snapshotsForTest()

      // eslint-disable-next-line no-console
      console.log(`[${fixture}] contexts=${loader.contextEntries.length} actions=${totalActions} resources=${totalResources} snapshotFrames=${snapshotFrames.length}`)

      expect(totalActions).toBeGreaterThan(0)
    })

    it(`renders a DOM snapshot to HTML from ${fixture}`, async () => {
      const loader = await loadTrace(fixture)
      const storage = loader.storage()
      const snapshots = storage.snapshotsForTest()
      const [callId, phase] = snapshots[0]?.split('/') ?? []
      const html = callId && phase
        ? storage.snapshotForCall(callId, phase as ActionPhase)?.render().html
        : undefined

      if (!snapshots.length) {
        // eslint-disable-next-line no-console
        console.log(`[${fixture}] no DOM snapshots in this trace, skipping render assertion`)
        return
      }

      expect(html).toBeDefined()
      expect(html!.toLowerCase()).toContain('<html')
      // eslint-disable-next-line no-console
      console.log(`[${fixture}] rendered snapshot html length=${html!.length}`)
    })
  }
})
