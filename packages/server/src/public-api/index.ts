import type { Context } from 'hono'
import { randomUUID } from 'node:crypto'
import { Readable, Transform } from 'node:stream'
import { zValidator } from '@hono/zod-validator'
import { countsByTagFrom, ingestRunSchema } from '@kinora/core'
import busboy from 'busboy'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { notifyRun } from '../alerts/notify'
import { getEntitlements, ingestCapError, quotaCrossing, quotaWarningText, storageCapError, usageEmailEnabled } from '../billing/entitlements'
import { meterRun } from '../billing/metering'
import { polarClient } from '../billing/polar'
import { currentPeriodResults, isHistory, projectCount, recordResults, storageBytes } from '../billing/usage'
import { db } from '../db'
import { artifact, member, organization, project, run, test, user } from '../db/schemas/index'
import { auth } from '../lib/auth'
import { env } from '../lib/env'
import { logger } from '../lib/logger'
import { sendMail } from '../lib/mailer'
import { isTransientStorageError, storage } from '../lib/storage'
import { computeRegression } from '../reports/regression'
import { registerReadRoutes } from './read'

const BEARER_PREFIX = 'Bearer '
const INGEST_MAX_JSON_MB = 25
// Matches the /api/v1 bodyLimit; busboy truncates the file part past this so RAM/disk stay bounded.
const MAX_ARTIFACT_BYTES = 100 * 1024 * 1024

// Public ingest API (api-key authed) - the reporter / cli upload here. The token's
// referenceId is the owning organization id.
export const publicApi = new Hono<{ Variables: { orgId: string } }>()

publicApi.use('*', async (c, next) => {
  const header = c.req.header('Authorization')
  if (!header?.startsWith(BEARER_PREFIX))
    return c.json({ error: 'Invalid API key' }, 401)

  const key = header.slice(BEARER_PREFIX.length).trim()
  const verification = await auth.api.verifyApiKey({ body: { key } })
  if (!verification.valid || !verification.key)
    return c.json({ error: 'Invalid API key' }, 401)

  c.set('orgId', verification.key.referenceId)
  await next()
})

// GET read routes (MCP server / API-key clients): registered after auth so they inherit the Bearer check.
registerReadRoutes(publicApi)

// A run report is JSON; cap it well below the trace.zip artifact limit so a huge body can't OOM the parse.
const ingestJsonLimit = bodyLimit({
  maxSize: INGEST_MAX_JSON_MB * 1024 * 1024,
  onError: c => c.json({ error: 'Payload too large' }, 413),
})

publicApi.post('/runs', ingestJsonLimit, zValidator('json', ingestRunSchema), async (c) => {
  const orgId = c.get('orgId')
  const input = c.req.valid('json')
  // Backfill only suppresses alerts (anti-spam); what is billed is decided by `history` below.
  const backfill = c.req.query('backfill') === '1'

  const entitlements = await getEntitlements(orgId)
  const existing = await db.query.project.findFirst({
    where: and(eq(project.organizationId, orgId), eq(project.slug, input.project.slug)),
    columns: { id: true },
  })
  const isNewProject = !existing

  // Result cap is read only for free (the only metered tier); project count only when capped + new.
  const usedResults = entitlements.tier === 'free' ? await currentPeriodResults(orgId) : 0
  const projects = isNewProject && Number.isFinite(entitlements.maxProjects) ? await projectCount(orgId) : 0
  const cap = ingestCapError(entitlements, usedResults, isNewProject, projects)
  if (cap)
    return c.json(cap, 402)

  const startedAt = new Date(input.run.startedAt)
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, orgId),
    columns: { createdAt: true, usageNearEmailEnabled: true, usageLimitEmailEnabled: true },
  })
  const history = !!org && isHistory(startedAt, org.createdAt)
  const billable = Boolean(polarClient) && input.tests.length > 0 && !history

  const result = await db.transaction(async (tx) => {
    let projectId = existing?.id
    if (!projectId) {
      // Concurrent imports race to create the same slug; let the unique index arbitrate, then re-read.
      const inserted = await tx.insert(project).values({
        id: randomUUID(),
        organizationId: orgId,
        slug: input.project.slug,
        name: input.project.name,
      }).onConflictDoNothing({ target: [project.organizationId, project.slug] }).returning({ id: project.id })
      projectId = inserted[0]?.id ?? (await tx.query.project.findFirst({
        where: and(eq(project.organizationId, orgId), eq(project.slug, input.project.slug)),
        columns: { id: true },
      }))?.id
    }

    const runId = randomUUID()
    await tx.insert(run).values({
      id: runId,
      projectId,
      startedAt,
      // Playwright reports fractional ms; the column is integer.
      duration: Math.round(input.run.duration),
      counts: input.run.counts,
      countsByTag: countsByTagFrom(input.tests),
      playwrightVersion: input.run.playwrightVersion,
      git: input.run.git,
      ci: input.run.ci,
      shards: input.run.shards,
      meterPending: billable,
    })

    if (input.tests.length) {
      await tx.insert(test).values(input.tests.map(item => ({
        id: randomUUID(),
        runId,
        projectId,
        testKey: item.testKey,
        title: item.title,
        titlePath: item.titlePath,
        file: item.file,
        line: item.line,
        column: item.column,
        projectName: item.projectName,
        status: item.status,
        ok: item.ok,
        duration: Math.round(item.duration),
        retries: item.retries,
        tags: item.tags,
        annotations: item.annotations,
        errors: item.errors,
        attachments: item.attachments,
      })))
    }

    await recordResults(tx, orgId, history ? startedAt : new Date(), input.tests.length)

    return { projectId, runId, tests: input.tests.length }
  })

  if (billable)
    await meterRun(result.runId, orgId, result.tests)

  if (!backfill) {
    // Fire-and-forget: alerts hit external webhook/Slack/SMTP and must not block or fail the ingest response.
    void notifyRun({
      organizationId: orgId,
      projectId: result.projectId,
      runId: result.runId,
      startedAt: new Date(input.run.startedAt),
      branch: input.run.git?.branch,
      counts: input.run.counts,
      tests: input.tests,
    }).catch(error => logger.error({ error, runId: result.runId }, 'alert notify failed'))
  }

  // Free-tier usage warning, fired on the ingest that crosses 80% / 100% of the monthly cap.
  if (!backfill && !history && entitlements.tier === 'free' && result.tests > 0) {
    const kind = quotaCrossing(usedResults, usedResults + result.tests, entitlements.includedResults)
    if (kind && usageEmailEnabled(entitlements.tier, kind, org ?? {})) {
      try {
        const owner = await db.query.member.findFirst({
          where: and(eq(member.organizationId, orgId), eq(member.role, 'owner')),
          columns: { userId: true },
        })
        const u = owner
          ? await db.query.user.findFirst({ where: eq(user.id, owner.userId), columns: { email: true, name: true } })
          : null
        if (u) {
          sendMail({
            to: u.email,
            subject: kind === 'reached' ? 'You\'ve hit your kinora free limit' : 'You\'re nearing your kinora free limit',
            text: quotaWarningText(u.name, kind, usedResults + result.tests, entitlements.includedResults, `${env.WEB_ORIGIN}/settings/workspace`),
          })
        }
      }
      catch (error) {
        logger.error({ error, orgId }, 'quota warning email failed')
      }
    }
  }

  // Durable dashboard URL (client only knows the api origin). Regression is only computed when the
  // client asks (?regression=1, set by prComment users) so the hot path isn't taxed for everyone,
  // and never fails the response for an already-committed run.
  const runUrl = `${env.WEB_ORIGIN}/projects/${input.project.slug}/runs/${result.runId}`
  let regression
  if (!backfill && result.projectId && c.req.query('regression') === '1') {
    try {
      regression = await computeRegression(result.projectId, input.tests, {
        branch: input.run.git?.branch,
        baseBranch: input.run.git?.baseBranch,
        startedAt: new Date(input.run.startedAt),
      })
    }
    catch (error) {
      logger.error({ error, runId: result.runId }, 'regression compute failed')
    }
  }

  return c.json({ ...result, runUrl, ...(regression ? { regression } : {}) }, 201)
})

interface StreamedArtifact {
  key: string
  name: string
  contentType: string
  testKey: string
  size: number
}

const MIME_EXTENSIONS: Record<string, string> = {
  'application/zip': 'zip',
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
}

// Playwright attachment names carry no extension ("trace", "video"), and /artifacts/* types its
// responses from the stored key, so the extension has to come from the content type.
function withExtension(name: string, contentType: string): string {
  const dot = name.lastIndexOf('.')
  const fromName = dot > 0 ? name.slice(dot + 1).replace(/\W/g, '') : ''
  const ext = MIME_EXTENSIONS[contentType.split(';')[0].trim()] || fromName || 'zip'
  return name.endsWith(`.${ext}`) ? name : `${name}.${ext}`
}

// Parse the multipart upload and stream the file part straight to storage so a large trace.zip is
// never fully buffered. null = no file part; { tooLarge } = file part exceeded the byte cap.
async function streamArtifact(c: Context, projectId: string, runId: string): Promise<StreamedArtifact | { tooLarge: true } | null> {
  const contentType = c.req.header('content-type') ?? ''
  const reqBody = c.req.raw.body
  if (!reqBody || !contentType.includes('multipart/form-data'))
    return null

  return new Promise((resolve, reject) => {
    const bb = busboy({ headers: { 'content-type': contentType }, limits: { files: 1, fields: 10, fileSize: MAX_ARTIFACT_BYTES } })
    let testKey = ''
    let nameField = ''
    let fileContentType = 'application/zip'
    let key = ''
    let size = 0
    let tooLarge = false
    let putPromise: Promise<void> | null = null
    let putError: unknown

    bb.on('field', (field, value) => {
      if (field === 'testKey')
        testKey = value
      else if (field === 'name')
        nameField = value
    })

    bb.on('file', (_field, fileStream, info) => {
      fileContentType = info.mimeType || 'application/zip'
      // The reporter sends the file part before the name field, so derive the key from its filename.
      const safeName = (info.filename || 'trace').replace(/[^\w.-]/g, '_').slice(0, 100) || 'trace'
      key = `${projectId}/${runId}/${randomUUID()}-${withExtension(safeName, fileContentType)}`
      fileStream.on('limit', () => {
        tooLarge = true
      })
      // Transform buffers + backpressures (unlike a raw 'data' listener), so counting loses no bytes.
      const counted = fileStream.pipe(new Transform({
        transform(chunk, _enc, cb) {
          size += chunk.length
          cb(null, chunk)
        },
      }))
      fileStream.on('error', err => counted.destroy(err))
      // Capture rather than reject here so a busboy 'error' before 'close' can't leave this unhandled.
      putPromise = storage.put(key, counted).catch((err) => {
        putError = err
      })
    })

    bb.on('error', reject)
    bb.on('close', () => {
      void (async () => {
        if (!putPromise)
          return resolve(null)
        await putPromise
        if (putError)
          return reject(putError)
        if (tooLarge) {
          await storage.delete(key).catch(() => {}) // drop the truncated object
          return resolve({ tooLarge: true })
        }
        resolve({ key, name: nameField || 'trace', contentType: fileContentType, testKey, size })
      })()
    })

    Readable.fromWeb(reqBody as Parameters<typeof Readable.fromWeb>[0]).pipe(bb)
  })
}

// Upload a trace.zip (or other binary artifact) for a run, linked to a test.
publicApi.post('/runs/:runId/artifacts', async (c) => {
  const orgId = c.get('orgId')
  const runId = c.req.param('runId')

  const r = await db.query.run.findFirst({
    where: eq(run.id, runId),
    columns: { id: true, projectId: true },
  })
  if (!r)
    return c.json({ error: 'Run not found' }, 404)

  const owner = await db.query.project.findFirst({
    where: and(eq(project.id, r.projectId), eq(project.organizationId, orgId)),
    columns: { id: true },
  })
  if (!owner)
    return c.json({ error: 'Run not found' }, 404)

  // One usage read per upload, reused after streaming to judge the artifact that just landed.
  const entitlements = await getEntitlements(orgId)
  const usedBytes = Number.isFinite(entitlements.storageBytes) ? await storageBytes(orgId) : 0
  // Probe with a single byte: no room for that means no room for anything, so skip reading the body.
  const full = storageCapError(entitlements, usedBytes, 1)
  if (full)
    return c.json(full, 402)

  let uploaded: Awaited<ReturnType<typeof streamArtifact>>
  try {
    uploaded = await streamArtifact(c, r.projectId, runId)
  }
  catch (err) {
    if (isTransientStorageError(err)) {
      logger.warn({ err, projectId: r.projectId, runId }, 'artifact storage temporarily unavailable')
      return c.json({ error: 'Artifact storage temporarily unavailable' }, 503)
    }
    throw err
  }
  if (!uploaded)
    return c.json({ error: 'file is required' }, 400)
  if ('tooLarge' in uploaded)
    return c.json({ error: 'Artifact too large' }, 413)

  const overCap = storageCapError(entitlements, usedBytes, uploaded.size)
  if (overCap) {
    await storage.delete(uploaded.key).catch(error => logger.error({ error, key: uploaded.key }, 'over-cap artifact cleanup failed'))
    return c.json(overCap, 402)
  }

  const t = uploaded.testKey
    ? await db.query.test.findFirst({
        where: and(eq(test.runId, runId), eq(test.testKey, uploaded.testKey)),
        columns: { id: true },
      })
    : undefined

  await db.insert(artifact).values({
    id: randomUUID(),
    projectId: r.projectId,
    runId,
    testId: t?.id,
    name: uploaded.name,
    contentType: uploaded.contentType,
    storageKey: uploaded.key,
    size: uploaded.size,
  })

  return c.json({ url: await storage.url(uploaded.key) }, 201)
})
