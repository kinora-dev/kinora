import { Buffer } from 'node:buffer'
import { randomUUID } from 'node:crypto'
import { Readable } from 'node:stream'
import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { beforeAll, describe, expect, it } from 'vitest'
import { s3Storage } from '../src/lib/storage'

// Exercises the real S3 path (lib-storage streaming Upload + presigned GET + delete) against the
// S3-compatible server on localhost:9000. The global `storage` singleton stays on local FS
// (test-env keeps S3_* empty) so the FS path + signed /artifacts serving stay covered.
const config = {
  endpoint: 'http://localhost:9000',
  region: 'us-east-1',
  bucket: 'kinora-test',
  accessKey: 'minio',
  secretKey: 'minio12345',
}

describe('s3 storage', () => {
  const storage = s3Storage(config)

  beforeAll(async () => {
    const client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
      forcePathStyle: true,
    })
    try {
      await client.send(new CreateBucketCommand({ Bucket: config.bucket }))
    }
    catch {
      // bucket already exists from a previous run
    }
  })

  it('streams a Readable body up and back down byte-for-byte via the presigned url', async () => {
    const bytes = Buffer.from('PK\x03\x04 streamed-via-lib-storage-multipart')
    const key = `test/${randomUUID()}-stream.zip`
    await storage.put(key, Readable.from([bytes]))
    const res = await fetch(await storage.url(key))
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true)
    await storage.delete(key)
  })

  it('accepts a Buffer body too (the seed path)', async () => {
    const bytes = Buffer.from('buffer-body-path')
    const key = `test/${randomUUID()}-buf.zip`
    await storage.put(key, bytes)
    const res = await fetch(await storage.url(key))
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).equals(bytes)).toBe(true)
    await storage.delete(key)
  })

  it('delete removes the object', async () => {
    const key = `test/${randomUUID()}-del.zip`
    await storage.put(key, Buffer.from('x'))
    await storage.delete(key)
    const res = await fetch(await storage.url(key))
    expect(res.ok).toBe(false)
  })
})
