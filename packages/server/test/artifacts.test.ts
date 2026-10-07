import { Buffer } from 'node:buffer'
import { resolve, sep } from 'node:path'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { app } from '../src/app'
import { db } from '../src/db'
import { artifactSignature, verifyArtifactSignature } from '../src/lib/artifact-url'
import { env } from '../src/lib/env'
import { storage } from '../src/lib/storage'
import { findProject, loadRun, loadRunReport } from '../src/reports/queries'
import { createApiKey, createUser, ingest, ownedOrgId, resetDb, runPayload } from './helpers'

beforeEach(resetDb)

const root = resolve(env.STORAGE_DIR)

async function uploadArtifact(name: string) {
  const user = await createUser()
  const apiKey = await createApiKey(user.id)
  await ingest(apiKey)
  const run = (await db.query.run.findMany())[0]

  const form = new FormData()
  // The key derives from the file part's filename, so the traversal payload rides there.
  form.set('file', new File([new Uint8Array([0x50, 0x4B, 0x03, 0x04])], name))
  form.set('name', name)
  const res = await app.request(`/api/v1/runs/${run.id}/artifacts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  })
  return { res, run }
}

describe('artifact upload', () => {
  it('sanitizes a traversal name so the stored key stays under the run prefix', async () => {
    const { res, run } = await uploadArtifact('../../../../../../tmp/pwned')
    expect(res.status).toBe(201)

    const a = (await db.query.artifact.findMany())[0]
    // key shape is `${projectId}/${runId}/${uuid}-${name}.zip`: exactly 3 path segments, no escape.
    expect(a.storageKey.startsWith(`${run.projectId}/${run.id}/`)).toBe(true)
    expect(a.storageKey.split('/')).toHaveLength(3)
    expect(resolve(root, a.storageKey).startsWith(root + sep)).toBe(true)
  })

  it('streams the uploaded bytes verbatim and records the size', async () => {
    const bytes = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 1, 2, 3, 4, 5, 6, 7])
    const user = await createUser()
    const apiKey = await createApiKey(user.id)
    await ingest(apiKey)
    const run = (await db.query.run.findMany())[0]

    const form = new FormData()
    form.set('file', new File([bytes], 'trace.zip'))
    form.set('name', 'trace')
    const res = await app.request(`/api/v1/runs/${run.id}/artifacts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    expect(res.status).toBe(201)

    const a = (await db.query.artifact.findMany())[0]
    expect(a.size).toBe(bytes.length)

    // Round-trip: fetch it back through the signed URL and compare bytes.
    const url = new URL((await res.json() as { url: string }).url)
    const got = await app.request(url.pathname + url.search)
    expect(got.status).toBe(200)
    expect([...new Uint8Array(await got.arrayBuffer())]).toEqual([...bytes])
  })

  it('keeps the media extension so the artifact serves with its own content type', async () => {
    const user = await createUser()
    const apiKey = await createApiKey(user.id)
    await ingest(apiKey)
    const run = (await db.query.run.findMany())[0]

    const form = new FormData()
    // The reporter names the part after the Playwright attachment ("video"), extension-less.
    form.set('file', new File([new Uint8Array([1, 2, 3])], 'video', { type: 'video/webm' }))
    form.set('name', 'video')
    const res = await app.request(`/api/v1/runs/${run.id}/artifacts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    expect(res.status).toBe(201)

    const a = (await db.query.artifact.findMany())[0]
    expect(a.storageKey.endsWith('.webm')).toBe(true)
    expect(a.contentType).toBe('video/webm')

    const url = new URL((await res.json() as { url: string }).url)
    const got = await app.request(url.pathname + url.search)
    expect(got.headers.get('content-type')).toContain('video/webm')
  })

  it('rejects an empty (no file part) upload', async () => {
    const user = await createUser()
    const apiKey = await createApiKey(user.id)
    await ingest(apiKey)
    const run = (await db.query.run.findMany())[0]

    const form = new FormData()
    form.set('name', 'trace')
    const res = await app.request(`/api/v1/runs/${run.id}/artifacts`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    })
    expect(res.status).toBe(400)
  })
})

async function postArtifact(runId: string, apiKey: string | null, opts: { testKey?: string, body?: string } = {}) {
  const headers: Record<string, string> = {}
  if (apiKey)
    headers.Authorization = `Bearer ${apiKey}`
  let body: string | FormData | undefined = opts.body
  if (!body) {
    const form = new FormData()
    form.set('file', new File([new Uint8Array([0x50, 0x4B, 0x03, 0x04])], 'trace.zip'))
    form.set('name', 'trace')
    if (opts.testKey !== undefined)
      form.set('testKey', opts.testKey)
    body = form
  }
  else {
    headers['content-type'] = 'application/json'
  }
  return app.request(`/api/v1/runs/${runId}/artifacts`, { method: 'POST', headers, body })
}

describe('artifact upload - access + linking', () => {
  it('rejects an upload with no API key (401)', async () => {
    const res = await postArtifact('any-run', null)
    expect(res.status).toBe(401)
  })

  it('returns 404 for an unknown run', async () => {
    const user = await createUser()
    const apiKey = await createApiKey(user.id)
    const res = await postArtifact('does-not-exist', apiKey)
    expect(res.status).toBe(404)
  })

  it('returns 404 when the run belongs to another org (no cross-org upload)', async () => {
    const owner = await createUser('owner@test.dev')
    const ownerKey = await createApiKey(owner.id)
    await ingest(ownerKey)
    const run = (await db.query.run.findMany())[0]

    const stranger = await createUser('stranger@test.dev')
    const strangerKey = await createApiKey(stranger.id)
    const res = await postArtifact(run.id, strangerKey)
    expect(res.status).toBe(404)
    expect(await db.query.artifact.findMany()).toHaveLength(0)
  })

  it('links the artifact to the test matching the testKey', async () => {
    const user = await createUser()
    const apiKey = await createApiKey(user.id)
    await ingest(apiKey)
    const run = (await db.query.run.findMany())[0]
    const t = (await db.query.test.findMany())[0]

    const res = await postArtifact(run.id, apiKey, { testKey: t.testKey })
    expect(res.status).toBe(201)
    const a = (await db.query.artifact.findMany())[0]
    expect(a.testId).toBe(t.id)
  })

  it('stores a run-level artifact (testId null) for an unknown testKey', async () => {
    const user = await createUser()
    const apiKey = await createApiKey(user.id)
    await ingest(apiKey)
    const run = (await db.query.run.findMany())[0]

    const res = await postArtifact(run.id, apiKey, { testKey: 'no-such-test' })
    expect(res.status).toBe(201)
    const a = (await db.query.artifact.findMany())[0]
    expect(a.testId).toBeNull()
  })

  it('rejects a non-multipart body (400)', async () => {
    const user = await createUser()
    const apiKey = await createApiKey(user.id)
    await ingest(apiKey)
    const run = (await db.query.run.findMany())[0]

    const res = await postArtifact(run.id, apiKey, { body: JSON.stringify({ not: 'multipart' }) })
    expect(res.status).toBe(400)
  })

  it('returns 503 without recording an artifact when object storage throttles', async () => {
    const user = await createUser()
    const apiKey = await createApiKey(user.id)
    await ingest(apiKey)
    const run = (await db.query.run.findMany())[0]
    const spy = vi.spyOn(storage, 'put').mockImplementationOnce(async (_key, body) => {
      if (body && typeof body === 'object' && 'resume' in body && typeof body.resume === 'function')
        body.resume()
      throw Object.assign(new Error('UnknownError'), { name: 'SlowDown', $metadata: { httpStatusCode: 503 } })
    })

    try {
      const res = await postArtifact(run.id, apiKey)
      expect(res.status).toBe(503)
      expect(await res.json()).toEqual({ error: 'Artifact storage temporarily unavailable' })
      expect(await db.query.artifact.findMany()).toHaveLength(0)
    }
    finally {
      spy.mockRestore()
    }
  })
})

describe('run report artifact urls', () => {
  it('gives each occurrence of a repeated attachment name its own url', async () => {
    const user = await createUser()
    const apiKey = await createApiKey(user.id)
    const payload = runPayload()
    payload.tests[0].attachments = [
      { name: 'screenshot', contentType: 'image/png', hasBody: false },
      { name: 'screenshot', contentType: 'image/png', hasBody: false },
    ]
    await ingest(apiKey, payload)
    const r = (await db.query.run.findMany())[0]
    const t = (await db.query.test.findMany())[0]

    for (const byte of [1, 2]) {
      const form = new FormData()
      form.set('file', new File([new Uint8Array([byte])], 'screenshot', { type: 'image/png' }))
      form.set('name', 'screenshot')
      form.set('testKey', t.testKey)
      const res = await app.request(`/api/v1/runs/${r.id}/artifacts`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      })
      expect(res.status).toBe(201)
    }

    const p = await findProject(await ownedOrgId(user.id), payload.project.slug)
    const report = await loadRunReport(p!, (await loadRun(p!.id, r.id))!)
    const [first, second] = report.tests[0].attachments
    expect(first.url).toBeTruthy()
    expect(second.url).toBeTruthy()
    expect(first.url).not.toBe(second.url)
  })
})

describe('local storage guard', () => {
  it('rejects a relative key that escapes the storage root', async () => {
    await expect(storage.put('../escape.zip', Buffer.from('x'))).rejects.toThrow('invalid storage key')
  })

  it('rejects an absolute key', async () => {
    await expect(storage.put('/tmp/escape.zip', Buffer.from('x'))).rejects.toThrow('invalid storage key')
  })
})

describe('artifact signature', () => {
  it('accepts a fresh signature and rejects tampering, cross-key reuse, expiry, and absence', () => {
    const key = 'proj/run/abc-trace.zip'
    const params = new URLSearchParams(artifactSignature(key))
    const exp = params.get('exp')
    const sig = params.get('sig')
    expect(verifyArtifactSignature(key, exp, sig)).toBe(true)
    expect(verifyArtifactSignature(key, exp, `${sig}x`)).toBe(false)
    expect(verifyArtifactSignature('proj/run/other.zip', exp, sig)).toBe(false)
    expect(verifyArtifactSignature(key, String(Date.now() - 1), sig)).toBe(false)
    expect(verifyArtifactSignature(key, undefined, undefined)).toBe(false)
  })

  it('the /artifacts route rejects an unsigned request with 403', async () => {
    const res = await app.request('/artifacts/proj/run/whatever.zip')
    expect(res.status).toBe(403)
  })
})
