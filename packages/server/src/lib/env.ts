import { existsSync } from 'node:fs'
import process from 'node:process'
import { z } from 'zod'

if (existsSync('.env'))
  process.loadEnvFile()

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production']),
  PORT: z.coerce.number(),
  BASE_URL: z.url(),
  WEB_ORIGIN: z.string(),
  // Share the session cookie across subdomains (e.g. .kinora.dev for app/api). Unset = host-only (single-origin self-host).
  COOKIE_DOMAIN: z.string().optional(),
  AUTH_SECRET: z.string(),
  POSTGRES_USER: z.string(),
  POSTGRES_PASSWORD: z.string(),
  POSTGRES_HOST: z.string(),
  POSTGRES_PORT: z.coerce.number(),
  POSTGRES_DB: z.string(),
  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GITHUB_CLIENT_ID: z.string().default(''),
  GITHUB_CLIENT_SECRET: z.string().default(''),
  KINORA_CLOUD: z.stringbool().default(false),
  // Public demo instance: auto-session as the seeded demo user + read-only (no mutations/ingest/auth writes).
  KINORA_DEMO: z.stringbool().default(false),
  POLAR_ACCESS_TOKEN: z.string().optional(),
  POLAR_WEBHOOK_SECRET: z.string().optional(),
  POLAR_PRODUCT_TEAM_ID: z.string().optional(),
  POLAR_PRODUCT_PRO_ID: z.string().optional(),
  // Ingest requests per minute per client IP (DoS backstop; sharded CI spreads across IPs). Raise for pathological suites.
  INGEST_RATE_LIMIT: z.coerce.number().int().positive().default(600),
  // Dashboard (tRPC) requests per minute per client IP. Raise it when many users share one IP (office NAT, e2e).
  TRPC_RATE_LIMIT: z.coerce.number().int().positive().default(300),
  // Self-host retention. 0 = keep forever; ignored in cloud, where the plan tier drives it.
  KINORA_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0),
  KINORA_KEEP_LAST_RUNS: z.coerce.number().int().nonnegative().default(0),
  KINORA_ARTIFACT_RETENTION_DAYS: z.coerce.number().int().nonnegative().default(0),
  STORAGE_DIR: z.string().default('.data/artifacts'),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  SLACK_CLIENT_ID: z.string().optional(),
  SLACK_CLIENT_SECRET: z.string().optional(),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM: z.string().optional(),
  SENTRY_DSN: z.string().optional(),
  FEEDBACK_TRACKER_API_KEY: z.string().optional(),
  FEEDBACK_TRACKER_PROJECT_ID: z.string().optional(),
  FEEDBACK_TRACKER_WORKSPACE_ID: z.string().optional(),
  FEEDBACK_TRACKER_API_URL: z.union([z.literal(''), z.url()]).optional(),
}).refine(
  e => !e.KINORA_CLOUD || Boolean(e.POLAR_ACCESS_TOKEN && e.POLAR_WEBHOOK_SECRET && e.POLAR_PRODUCT_TEAM_ID && e.POLAR_PRODUCT_PRO_ID),
  { message: 'KINORA_CLOUD=true requires POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET, POLAR_PRODUCT_TEAM_ID and POLAR_PRODUCT_PRO_ID' },
).refine(
  // Cross-subdomain cookies are a prod concern (app./api.); dev runs on localhost where
  // the two ports already share host-only cookies, so COOKIE_DOMAIN can stay empty there.
  e => !(e.KINORA_CLOUD && e.NODE_ENV === 'production') || Boolean(e.COOKIE_DOMAIN),
  { message: 'KINORA_CLOUD=true in production requires COOKIE_DOMAIN (e.g. .kinora.dev)' },
)

export type Env = z.infer<typeof envSchema>

export const env = envSchema.parse(process.env)

export interface CloudConfig {
  accessToken: string
  webhookSecret: string
  teamProductId: string
  proProductId: string
}

function resolveCloud(): CloudConfig | null {
  if (!env.KINORA_CLOUD)
    return null

  const { POLAR_ACCESS_TOKEN, POLAR_WEBHOOK_SECRET, POLAR_PRODUCT_TEAM_ID, POLAR_PRODUCT_PRO_ID } = env
  if (!POLAR_ACCESS_TOKEN || !POLAR_WEBHOOK_SECRET || !POLAR_PRODUCT_TEAM_ID || !POLAR_PRODUCT_PRO_ID)
    throw new Error('KINORA_CLOUD=true requires all POLAR_* env vars')

  return {
    accessToken: POLAR_ACCESS_TOKEN,
    webhookSecret: POLAR_WEBHOOK_SECRET,
    teamProductId: POLAR_PRODUCT_TEAM_ID,
    proProductId: POLAR_PRODUCT_PRO_ID,
  }
}

export const cloud = resolveCloud()

export const demo = env.KINORA_DEMO

export interface RetentionPolicy {
  runDays: number
  keepLastRuns: number
  artifactDays: number
}

// null = nothing to sweep, which also gates the in-process sweeper (cloud sweeps via its own cron).
function resolveRetention(): RetentionPolicy | null {
  if (env.KINORA_CLOUD)
    return null

  const policy = {
    runDays: env.KINORA_RETENTION_DAYS,
    keepLastRuns: env.KINORA_KEEP_LAST_RUNS,
    artifactDays: env.KINORA_ARTIFACT_RETENTION_DAYS,
  }
  return policy.runDays || policy.keepLastRuns || policy.artifactDays ? policy : null
}

export const retentionPolicy = resolveRetention()

// Social login is enabled per provider only when both its id and secret are set.
export const googleOauthEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET)
export const githubOauthEnabled = Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET)

export interface S3Config {
  endpoint: string
  region: string
  bucket: string
  accessKey: string
  secretKey: string
}

function resolveS3(): S3Config | null {
  const {
    S3_ENDPOINT: endpoint,
    S3_REGION: region,
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: accessKey,
    S3_SECRET_ACCESS_KEY: secretKey,
  } = env
  if (!endpoint || !region || !bucket || !accessKey || !secretKey)
    return null
  return { endpoint, region, bucket, accessKey, secretKey }
}

export const s3 = resolveS3()

export interface SlackAppConfig {
  clientId: string
  clientSecret: string
}

// "Add to Slack" OAuth app; null falls back to the manual webhook-URL paste
function resolveSlackApp(): SlackAppConfig | null {
  const { SLACK_CLIENT_ID: clientId, SLACK_CLIENT_SECRET: clientSecret } = env
  if (!clientId || !clientSecret)
    return null
  return { clientId, clientSecret }
}

export const slackApp = resolveSlackApp()

export interface SmtpConfig {
  host: string
  port: number
  user?: string
  pass?: string
  from: string
}

// Generic SMTP so self-hosters can plug any provider; null disables email flows.
function resolveSmtp(): SmtpConfig | null {
  const { SMTP_HOST: host, SMTP_PORT: port, SMTP_USER: user, SMTP_PASS: pass, SMTP_FROM: from } = env
  if (!host || !port || !from)
    return null
  return { host, port, user, pass, from }
}

export const smtp = resolveSmtp()

export interface FeedbackTrackerConfig {
  apiKey: string
  projectId: string
  workspaceId: string
  apiUrl: string
}

// User feedback -> private task tracker. Cloud-only: self-host instances must not post to our tracker.
function resolveFeedbackTracker(): FeedbackTrackerConfig | null {
  if (!env.KINORA_CLOUD)
    return null
  const {
    FEEDBACK_TRACKER_API_KEY: apiKey,
    FEEDBACK_TRACKER_PROJECT_ID: projectId,
    FEEDBACK_TRACKER_WORKSPACE_ID: workspaceId,
    FEEDBACK_TRACKER_API_URL: apiUrl,
  } = env
  if (!apiKey || !projectId || !workspaceId || !apiUrl)
    return null
  return { apiKey, projectId, workspaceId, apiUrl }
}

export const feedbackTrackerConfig = resolveFeedbackTracker()
