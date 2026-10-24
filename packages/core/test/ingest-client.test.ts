import type { IngestRun } from '../src/index'
import { describe, expect, it } from 'vitest'
import { buildIngestRun, createIngestClient, describeRetry, IngestError } from '../src/index'

const PAYLOAD: IngestRun = {
  project: { slug: 'web-app', name: 'web-app' },
  run: {
    startedAt: '2026-01-01T00:00:00.000Z',
    duration: 0,
    counts: { total: 0, expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
  },
  tests: [],
}

function clientWith(response: Response) {
  return createIngestClient({ baseUrl: 'http://test', token: 't', fetch: async () => response })
}

describe('createIngestClient.uploadRun', () => {
  it('surfaces the server error message on 402', async () => {
    const client = clientWith(
      new Response(JSON.stringify({ error: 'Free plan limit reached. Upgrade.', limit: 2500 }), { status: 402 }),
    )
    const err = await client.uploadRun(PAYLOAD).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IngestError)
    expect((err as IngestError).status).toBe(402)
    expect((err as IngestError).message).toBe('Free plan limit reached. Upgrade.')
  })

  it('falls back to the raw body when it is not JSON', async () => {
    const client = clientWith(new Response('upstream exploded', { status: 500 }))
    const err = await client.uploadRun(PAYLOAD).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IngestError)
    expect((err as IngestError).status).toBe(500)
    expect((err as IngestError).message).toBe('upstream exploded')
  })

  it('returns the parsed result on success', async () => {
    const client = clientWith(
      new Response(JSON.stringify({ projectId: 'p1', runId: 'r1', tests: 3 }), { status: 201 }),
    )
    await expect(client.uploadRun(PAYLOAD)).resolves.toEqual({ projectId: 'p1', runId: 'r1', tests: 3 })
  })

  it('strips trailing slashes from baseUrl when building the request url', async () => {
    let calledUrl = ''
    const client = createIngestClient({
      baseUrl: 'http://test///',
      token: 't',
      fetch: async (url) => {
        calledUrl = String(url)
        return new Response(JSON.stringify({ projectId: 'p1', runId: 'r1', tests: 0 }), { status: 201 })
      },
    })
    await client.uploadRun(PAYLOAD)
    expect(calledUrl).toBe('http://test/api/v1/runs')
  })
})

describe('createIngestClient retries', () => {
  const ok = () => new Response(JSON.stringify({ projectId: 'p1', runId: 'r1', tests: 0 }), { status: 201 })

  it('retries an unreachable server with the same idempotency key, reporting each wait', async () => {
    const keys: (string | null)[] = []
    const retries: number[] = []
    let calls = 0
    const client = createIngestClient({
      baseUrl: 'http://test',
      token: 't',
      retryDelays: [0, 0, 0],
      onRetry: info => retries.push(info.attempt),
      fetch: async (_url, init) => {
        keys.push(new Headers(init?.headers).get('idempotency-key'))
        calls++
        if (calls === 1)
          throw new TypeError('fetch failed')
        if (calls === 2)
          return new Response('Bad Gateway', { status: 502 })
        return ok()
      },
    })

    await expect(client.uploadRun(PAYLOAD)).resolves.toMatchObject({ runId: 'r1' })
    expect(calls).toBe(3)
    expect(retries).toEqual([1, 2])
    expect(keys[0]).toBeTruthy()
    expect(new Set(keys).size).toBe(1)
  })

  it('sends a new idempotency key for each run', async () => {
    const keys: (string | null)[] = []
    const client = createIngestClient({
      baseUrl: 'http://test',
      token: 't',
      fetch: async (_url, init) => {
        keys.push(new Headers(init?.headers).get('idempotency-key'))
        return ok()
      },
    })
    await client.uploadRun(PAYLOAD)
    await client.uploadRun(PAYLOAD)
    expect(keys[0]).not.toBe(keys[1])
  })

  it.each([400, 401, 402, 500])('does not retry a %i', async (status) => {
    let calls = 0
    const client = createIngestClient({
      baseUrl: 'http://test',
      token: 't',
      retryDelays: [0, 0],
      fetch: async () => {
        calls++
        return new Response('no', { status })
      },
    })
    await expect(client.uploadRun(PAYLOAD)).rejects.toMatchObject({ status })
    expect(calls).toBe(1)
  })

  it('gives up after the last delay, then fails fast until the server answers again', async () => {
    let calls = 0
    let up = false
    const client = createIngestClient({
      baseUrl: 'http://test',
      token: 't',
      retryDelays: [0, 0],
      fetch: async () => {
        calls++
        if (up)
          return new Response(JSON.stringify({ url: 'http://test/a.zip' }), { status: 201 })
        return new Response('down', { status: 503 })
      },
    })
    const artifact = { runId: 'r', testKey: 'k', name: 'trace', contentType: 'application/zip', body: new Uint8Array([1]) }

    await expect(client.uploadRun(PAYLOAD)).rejects.toMatchObject({ status: 503 })
    expect(calls).toBe(3)
    await expect(client.uploadArtifact(artifact)).rejects.toMatchObject({ status: 503 })
    expect(calls).toBe(4)

    up = true
    await expect(client.uploadArtifact(artifact)).resolves.toEqual({ url: 'http://test/a.zip' })
    up = false
    await expect(client.uploadArtifact(artifact)).rejects.toMatchObject({ status: 503 })
    expect(calls).toBe(8)
  })
})

describe('describeRetry', () => {
  it('names the cause and the wait', () => {
    expect(describeRetry({ error: new IngestError(503, 'x'), delayMs: 4100 })).toBe('kinora server unavailable (HTTP 503), retrying in 4s')
    expect(describeRetry({ error: new TypeError('fetch failed'), delayMs: 1000 })).toBe('kinora server unavailable (fetch failed), retrying in 1s')
  })
})

describe('buildIngestRun', () => {
  const RAW = {
    config: { version: '1.60.0' },
    stats: { startTime: '2026-01-01T00:00:00.000Z', duration: 1000, expected: 1, unexpected: 1, flaky: 0, skipped: 0 },
    suites: [{
      title: 'a.spec.ts',
      file: 'a.spec.ts',
      specs: [
        { title: 'passes', ok: true, tags: [], file: 'a.spec.ts', line: 3, column: 1, tests: [{ status: 'expected', projectName: 'chromium', results: [{ status: 'passed', duration: 5 }] }] },
        { title: 'fails', ok: false, tags: [], file: 'a.spec.ts', line: 7, column: 1, tests: [{ status: 'unexpected', projectName: 'chromium', results: [{ status: 'failed', duration: 9, errors: [{ message: 'boom' }] }] }] },
      ],
    }],
  }

  it('maps a raw playwright report to the wire payload', () => {
    const run = buildIngestRun(RAW, { project: { slug: 'web-app', name: 'web-app' } })
    expect(run.project).toEqual({ slug: 'web-app', name: 'web-app' })
    expect(run.run.counts).toMatchObject({ total: 2, expected: 1, unexpected: 1 })
    expect(run.run.playwrightVersion).toBe('1.60.0')
    expect(run.tests).toHaveLength(2)
  })
})

describe('createIngestClient.uploadArtifact', () => {
  it('posts a multipart form to the run and returns the parsed url', async () => {
    let calledUrl = ''
    let captured: Request | undefined
    const client = createIngestClient({
      baseUrl: 'http://test',
      token: 't',
      fetch: async (url, init) => {
        calledUrl = String(url)
        captured = new Request(String(url), init as RequestInit)
        return new Response(JSON.stringify({ url: 'http://test/artifacts/x.zip?sig=abc' }), { status: 201 })
      },
    })

    const res = await client.uploadArtifact({ runId: 'r 1', testKey: 'k', name: 'trace', contentType: 'application/zip', body: new Uint8Array([1, 2, 3]) })
    expect(res).toEqual({ url: 'http://test/artifacts/x.zip?sig=abc' })
    expect(calledUrl).toBe('http://test/api/v1/runs/r%201/artifacts') // runId is url-encoded
    const form = await captured!.formData()
    expect(form.get('testKey')).toBe('k')
    expect(form.get('name')).toBe('trace')
    expect(form.get('file')).toBeInstanceOf(File)
  })

  it('throws IngestError on a non-ok response', async () => {
    const client = clientWith(new Response(JSON.stringify({ error: 'too big' }), { status: 413 }))
    const err = await client.uploadArtifact({ runId: 'r', testKey: 'k', name: 'trace', contentType: 'application/zip', body: new Uint8Array([1]) }).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(IngestError)
    expect((err as IngestError).status).toBe(413)
    expect((err as IngestError).message).toBe('too big')
  })

  it('retries transient artifact upload responses', async () => {
    let calls = 0
    const client = createIngestClient({
      baseUrl: 'http://test',
      token: 't',
      retryDelays: [0],
      fetch: async () => {
        calls++
        if (calls === 1)
          return new Response(JSON.stringify({ error: 'Artifact storage temporarily unavailable' }), { status: 503 })
        return new Response(JSON.stringify({ url: 'http://test/a.zip' }), { status: 201 })
      },
    })

    await expect(client.uploadArtifact({ runId: 'r', testKey: 'k', name: 'trace', contentType: 'application/zip', body: new Uint8Array([1]) })).resolves.toEqual({ url: 'http://test/a.zip' })
    expect(calls).toBe(2)
  })

  it('accepts a Blob body', async () => {
    const client = clientWith(new Response(JSON.stringify({ url: 'http://test/a.zip' }), { status: 201 }))
    await expect(
      client.uploadArtifact({ runId: 'r', testKey: 'k', name: 'trace', contentType: 'application/zip', body: new Blob([new Uint8Array([1])]) }),
    ).resolves.toEqual({ url: 'http://test/a.zip' })
  })
})
