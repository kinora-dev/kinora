import type { Buffer } from 'node:buffer'
import type { S3Config } from './env'
import { createWriteStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { dirname, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DeleteObjectCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3'
import { Upload } from '@aws-sdk/lib-storage'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { artifactSignature } from './artifact-url'
import { env, s3 } from './env'

const TRANSIENT_STORAGE_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const TRANSIENT_STORAGE_NAMES = new Set(['SlowDown', 'RequestTimeout', 'TimeoutError', 'InternalError', 'ServiceUnavailable'])

// Trace.zip can be large; the upload path streams it through so it's never fully buffered in RAM.
export type StorageBody = Buffer | Uint8Array | Readable

// Local FS (dev/self-host) or any S3-compatible store. url() returns a presigned
// GET so the trace viewer fetches large trace.zip straight from storage (range-capable).
export interface Storage {
  put: (key: string, body: StorageBody) => Promise<void>
  url: (key: string) => Promise<string>
  delete: (key: string) => Promise<void>
}

export function isTransientStorageError(err: unknown): boolean {
  if (!err || typeof err !== 'object')
    return false
  const e = err as { name?: unknown, $metadata?: { httpStatusCode?: unknown }, $retryable?: unknown }
  return (
    (typeof e.$metadata?.httpStatusCode === 'number' && TRANSIENT_STORAGE_STATUSES.has(e.$metadata.httpStatusCode))
    || (typeof e.name === 'string' && TRANSIENT_STORAGE_NAMES.has(e.name))
    || !!e.$retryable
  )
}

function localStorage(): Storage {
  const root = resolve(env.STORAGE_DIR)
  // Reject keys that resolve outside STORAGE_DIR (defense in depth against traversal in the key).
  const within = (key: string): string => {
    const dest = resolve(root, key)
    if (dest !== root && !dest.startsWith(root + sep))
      throw new Error('invalid storage key')
    return dest
  }
  return {
    async put(key, body) {
      const dest = within(key)
      await mkdir(dirname(dest), { recursive: true })
      if (!(body instanceof Readable)) {
        await writeFile(dest, body)
        return
      }
      try {
        await pipeline(body, createWriteStream(dest))
      }
      catch (err) {
        await rm(dest, { force: true }) // drop the partial write
        throw err
      }
    },
    async url(key) {
      return `${env.BASE_URL}/artifacts/${key}?${artifactSignature(key)}`
    },
    async delete(key) {
      // force ignores a missing file, so retention purge stays idempotent.
      await rm(within(key), { force: true })
    },
  }
}

export function s3Storage(config: S3Config): Storage {
  const client = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: { accessKeyId: config.accessKey, secretAccessKey: config.secretKey },
    // Most S3-compatible providers (MinIO, Hetzner) need path-style URLs.
    forcePathStyle: true,
    // Give S3-compatible throttling / gateway blips a better chance to heal server-side.
    maxAttempts: 5,
    retryMode: 'standard',
  })
  return {
    async put(key, body) {
      // lib-storage Upload streams a Readable as multipart (and handles buffers too), so a large
      // trace.zip is never fully held in RAM. It needs an explicit abort to drop partial parts.
      const upload = new Upload({
        client,
        params: { Bucket: config.bucket, Key: key, Body: body, CacheControl: 'public, max-age=31536000, immutable' },
      })
      try {
        await upload.done()
      }
      catch (err) {
        await upload.abort().catch(() => {})
        throw err
      }
    },
    async url(key) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: 3600 })
    },
    async delete(key) {
      await client.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
    },
  }
}

export const storage: Storage = s3 ? s3Storage(s3) : localStorage()
