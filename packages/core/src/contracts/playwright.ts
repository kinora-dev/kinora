import { z } from 'zod'

// Subset of Playwright's `json` reporter output we read. Loose: tolerate
// version drift and unknown fields rather than reject a whole report.

export const pwTestStatus = z.enum(['expected', 'unexpected', 'flaky', 'skipped'])
export type PwTestStatus = z.infer<typeof pwTestStatus>

export const pwErrorSchema = z.looseObject({
  message: z.string().optional(),
  stack: z.string().optional(),
  value: z.string().optional(),
  location: z
    .looseObject({ file: z.string(), line: z.number(), column: z.number() })
    .optional(),
})

export const pwAttachmentSchema = z.looseObject({
  name: z.string(),
  contentType: z.string(),
  path: z.string().optional(),
  body: z.string().optional(), // base64; stripped on ingest
})

export const pwAnnotationSchema = z.looseObject({
  type: z.string(),
  description: z.string().optional(),
})

export const pwResultSchema = z.looseObject({
  status: z.string(),
  duration: z.number().default(0),
  retry: z.number().default(0),
  startTime: z.string().optional(),
  error: pwErrorSchema.optional(),
  errors: z.array(pwErrorSchema).default([]),
  attachments: z.array(pwAttachmentSchema).default([]),
  annotations: z.array(pwAnnotationSchema).default([]),
  workerIndex: z.number().optional(),
})

export const pwTestSchema = z.looseObject({
  status: pwTestStatus,
  expectedStatus: z.string().optional(),
  projectName: z.string().default(''),
  projectId: z.string().optional(),
  timeout: z.number().optional(),
  annotations: z.array(pwAnnotationSchema).default([]),
  results: z.array(pwResultSchema).default([]),
})

export const pwSpecSchema = z.looseObject({
  id: z.string().optional(),
  title: z.string(),
  ok: z.boolean().default(false),
  tags: z.array(z.string()).default([]),
  file: z.string().default(''),
  line: z.number().default(0),
  column: z.number().default(0),
  tests: z.array(pwTestSchema).default([]),
})

// Suite nests recursively: suites contain suites and specs.
export type PwSuite = z.infer<typeof pwSpecSchema> extends never ? never : PwSuiteShape
interface PwSuiteShape {
  title: string
  file?: string
  line?: number
  column?: number
  specs: z.infer<typeof pwSpecSchema>[]
  suites?: PwSuiteShape[]
}

export const pwSuiteSchema: z.ZodType<PwSuiteShape> = z.lazy(() =>
  z.looseObject({
    title: z.string(),
    file: z.string().optional(),
    line: z.number().optional(),
    column: z.number().optional(),
    specs: z.array(pwSpecSchema).default([]),
    suites: z.array(pwSuiteSchema).optional(),
  }),
)

export const pwStatsSchema = z.looseObject({
  startTime: z.string(),
  duration: z.number().default(0),
  expected: z.number().default(0),
  unexpected: z.number().default(0),
  flaky: z.number().default(0),
  skipped: z.number().default(0),
})

export const pwConfigSchema = z.looseObject({
  version: z.string().optional(),
  workers: z.number().optional().catch(undefined),
  rootDir: z.string().optional(),
  // `--shard`: which shard produced the report. A malformed value is dropped, not fatal.
  shard: z.object({ current: z.number().int().min(1), total: z.number().int().min(1) }).nullable().optional().catch(undefined),
  // `actualWorkers`: what the runner started, capped by the number of test groups.
  metadata: z.looseObject({ actualWorkers: z.number().optional().catch(undefined) }).optional(),
})

export const playwrightReportSchema = z.looseObject({
  config: pwConfigSchema.optional(),
  stats: pwStatsSchema,
  suites: z.array(pwSuiteSchema).default([]),
  errors: z.array(pwErrorSchema).default([]),
})

export type PlaywrightReport = z.infer<typeof playwrightReportSchema>
export type PwSpec = z.infer<typeof pwSpecSchema>
export type PwTest = z.infer<typeof pwTestSchema>
export type PwResult = z.infer<typeof pwResultSchema>
