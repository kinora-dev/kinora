import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { quarantineListFile, writeQuarantineList } from '../src/quarantine'

const located = (file: string, titles: string[], projectName = 'chromium') => ({ file, titlePath: [file, ...titles], projectName })

describe('quarantineListFile', () => {
  it('names each quarantined test, with its reason and expiry as a comment', () => {
    const { content, listed, skipped } = quarantineListFile([
      { testKey: 'a', reason: 'races the toast\nsee #12', expiresAt: '2026-12-01T00:00:00.000Z', test: located('cart.spec.ts', ['checkout', 'pays']) },
      { testKey: 'b', test: located('login.spec.ts', ['signs in'], '') },
    ], 'web-app')

    expect(content).toBe([
      '# kinora quarantine for web-app: run the suite with --test-list-invert, these with --test-list',
      '# races the toast see #12, until 2026-12-01',
      '[chromium] › cart.spec.ts › checkout › pays',
      'login.spec.ts › signs in',
      '',
    ].join('\n'))
    expect(listed).toBe(2)
    expect(skipped).toEqual([])
  })

  it('skips a test it cannot name instead of writing a line that would match others', () => {
    const { content, listed, skipped } = quarantineListFile([
      { testKey: 'gone' },
      { testKey: 'arrow', test: located('a.spec.ts', ['a › b']) },
    ], 'web-app')

    expect(listed).toBe(0)
    expect(skipped.map(s => s.testKey)).toEqual(['gone', 'arrow'])
    expect(content.split('\n').filter(l => l && !l.startsWith('#'))).toEqual([])
  })
})

describe('writeQuarantineList', () => {
  it('reads the quarantines through the read API and writes the list', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'kinora-quarantine-'))
    try {
      let requested = ''
      const fetch = (async (url: string | URL | Request) => {
        requested = String(url)
        return Response.json({ quarantines: [{ testKey: 'k', test: located('a.spec.ts', ['x']) }] })
      }) as typeof globalThis.fetch
      const out = join(dir, 'ci', 'quarantine.txt')
      const res = await writeQuarantineList({ project: 'web-app', url: 'https://api.example.com', token: 't', out, fetch })

      expect(requested).toBe('https://api.example.com/api/v1/projects/web-app/quarantines')
      expect(res.listed).toBe(1)
      expect(await readFile(out, 'utf8')).toContain('[chromium] › a.spec.ts › x\n')
    }
    finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
