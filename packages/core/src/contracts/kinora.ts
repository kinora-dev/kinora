import { z } from 'zod'
import { pwTestStatus } from './playwright'

export const SCHEMA_VERSION = 1

export const countsSchema = z.object({
  total: z.number(),
  expected: z.number(),
  unexpected: z.number(),
  flaky: z.number(),
  skipped: z.number(),
})
export type Counts = z.infer<typeof countsSchema>

// repoUrl/runUrl are rendered as link hrefs, so constrain to https (no javascript:/data:/http -> stored XSS).
// Tolerant: a bad value is dropped (catch -> undefined), not a reason to reject the whole run.
const linkUrl = z.url({ protocol: /^https$/ }).optional().catch(undefined)

export const gitMetaSchema = z.object({
  sha: z.string().optional(),
  branch: z.string().optional(),
  // Base branch on a PR/MR (detected from the CI env); powers "regression vs base" in the PR comment.
  baseBranch: z.string().optional(),
  // Remote URL (e.g. https://github.com/org/repo) to link a sha to its commit.
  repoUrl: linkUrl,
})
export type GitMeta = z.infer<typeof gitMetaSchema>

export const ciMetaSchema = z.object({
  provider: z.string().optional(),
  runUrl: linkUrl,
  runNumber: z.string().optional(),
})
export type CiMeta = z.infer<typeof ciMetaSchema>

// A run assembled from direct shard uploads is `open` until every shard landed, then `complete`;
// one still missing shards after the server's timeout is closed as `incomplete`. Single uploads
// are always `complete`.
export const runStatusSchema = z.enum(['open', 'complete', 'incomplete'])
export type RunStatus = z.infer<typeof runStatusSchema>

export const shardProgressSchema = z.object({ landed: z.number(), total: z.number() })
export type ShardProgress = z.infer<typeof shardProgressSchema>

// A run whose failures come from the environment under test (the app down, the browser crashing)
// rather than from the tests: left out of histories, baselines and regression alerts (lib/incident).
export const incidentRuleSchema = z.enum(['host-unreachable', 'browser-crash', 'manual'])
export type IncidentRule = z.infer<typeof incidentRuleSchema>

export const runIncidentSchema = z.object({
  rule: incidentRuleSchema,
  reason: z.string(),
  host: z.string().optional(),
})
export type RunIncident = z.infer<typeof runIncidentSchema>

// Someone marked or cleared the flag by hand: detection never overrides it.
export const incidentDecisionSchema = z.object({
  flagged: z.boolean(),
  by: z.string(),
  at: z.string(), // ISO 8601
})
export type IncidentDecision = z.infer<typeof incidentDecisionSchema>

// One row per run, stored in the manifest. Kept small: powers the overview
// grid and history charts without fetching full reports.
export const runSummarySchema = z.object({
  runId: z.string(),
  projectId: z.string(),
  startedAt: z.string(), // ISO 8601
  duration: z.number(), // ms
  counts: countsSchema,
  playwrightVersion: z.string().optional(),
  git: gitMetaSchema.optional(),
  ci: ciMetaSchema.optional(),
  shards: z.number().optional(),
  reportPath: z.string(), // relative path to the full RunReport JSON
  // Per-tag counts, precomputed at ingest so the overview can filter by tag
  // without fetching full reports. Keys are tag names (e.g. "@smoke").
  countsByTag: z.record(z.string(), countsSchema).default({}),
  status: runStatusSchema.optional(),
  shardProgress: shardProgressSchema.optional(),
  incident: runIncidentSchema.optional(),
  incidentDecision: incidentDecisionSchema.optional(),
})
export type RunSummary = z.infer<typeof runSummarySchema>

export const projectEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  runs: z.array(runSummarySchema),
})
export type ProjectEntry = z.infer<typeof projectEntrySchema>

// Root document the front fetches first. Single static file.
export const manifestSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  generatedAt: z.string(),
  projects: z.array(projectEntrySchema),
})
export type Manifest = z.infer<typeof manifestSchema>

export const normAttachmentSchema = z.object({
  name: z.string(),
  contentType: z.string(),
  path: z.string().optional(),
  hasBody: z.boolean(), // body stripped on ingest; flag that one existed
  url: z.string().optional(), // relative path to the copied artifact (e.g. trace.zip), if hosted
  // The hosted file was deleted by the server's artifact retention: the test keeps its history,
  // the attachment no longer has a file behind it. Set by the server only.
  expired: z.boolean().optional(),
})

export const normErrorSchema = z.object({
  message: z.string(),
  stack: z.string().optional(),
  location: z
    .object({ file: z.string(), line: z.number(), column: z.number() })
    .optional(),
})
export type NormError = z.infer<typeof normErrorSchema>

// Accessibility check of a test, from Storybook's a11y addon (axe). Only the violations travel:
// axe's full result also lists every passing rule with the HTML of each node, far too heavy.
export const A11Y_IMPACTS = ['minor', 'moderate', 'serious', 'critical'] as const
export const MAX_A11Y_VIOLATIONS = 50
export const MAX_A11Y_NODES = 10

export const a11yViolationSchema = z.object({
  id: z.string(), // axe rule, e.g. `color-contrast`
  impact: z.enum(A11Y_IMPACTS).optional(),
  help: z.string(),
  helpUrl: linkUrl,
  nodes: z.array(z.string()).max(MAX_A11Y_NODES), // CSS selectors of the failing elements, the first few
  nodeCount: z.number(), // every failing element, past the ones listed
})
export type A11yViolation = z.infer<typeof a11yViolationSchema>

export const a11yReportSchema = z.object({
  // passed: no violation. warning: violations of a story in `todo` mode, the test still passes.
  // failed: violations in `error` mode (the test fails), or axe itself failed (`error`).
  status: z.enum(['passed', 'warning', 'failed']),
  violations: z.array(a11yViolationSchema).max(MAX_A11Y_VIOLATIONS),
  error: z.string().optional(),
})
export type A11yReport = z.infer<typeof a11yReportSchema>

// Flattened test, identity stable across runs via testKey.
export const normTestSchema = z.object({
  testKey: z.string(),
  title: z.string(),
  titlePath: z.array(z.string()),
  file: z.string(),
  line: z.number(),
  column: z.number(),
  projectName: z.string(), // playwright project (e.g. browser), not kinora project
  status: pwTestStatus,
  ok: z.boolean(),
  duration: z.number(),
  retries: z.number(),
  tags: z.array(z.string()),
  annotations: z.array(z.object({ type: z.string(), description: z.string().optional() })),
  errors: z.array(normErrorSchema),
  attachments: z.array(normAttachmentSchema),
  codeOwners: z.array(z.string()).optional(),
  // A malformed report is dropped, not a reason to reject the whole run.
  a11y: a11yReportSchema.optional().catch(undefined),
})
export type NormTest = z.infer<typeof normTestSchema>

// Full per-run document, fetched lazily on drill-down. Attachment bodies stripped.
export const runReportSchema = z.object({
  schemaVersion: z.literal(SCHEMA_VERSION),
  runId: z.string(),
  projectId: z.string(),
  startedAt: z.string(),
  duration: z.number(),
  counts: countsSchema,
  meta: z.object({
    playwrightVersion: z.string().optional(),
    git: gitMetaSchema.optional(),
    ci: ciMetaSchema.optional(),
    shards: z.number().optional(),
    status: runStatusSchema.optional(),
    shardProgress: shardProgressSchema.optional(),
    incident: runIncidentSchema.optional(),
    incidentDecision: incidentDecisionSchema.optional(),
  }),
  tests: z.array(normTestSchema),
})
export type RunReport = z.infer<typeof runReportSchema>

// Per-test history, derived by folding run reports. Also the response shape of
// the REST `GET /api/projects/:id/tests` endpoint (server-computed instead).
export const testPointSchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  status: pwTestStatus,
  duration: z.number(),
  retries: z.number(),
  errorMessage: z.string().optional(),
  sha: z.string().optional(), // commit of the run, to tell flakiness from a change in the code
  // Failed screenshot assertions in that run (see lib/attachments). Their images are loaded on
  // demand, since a history spans hundreds of runs and image urls are signed at read time.
  screenshots: z.number().optional(),
})
export type TestPoint = z.infer<typeof testPointSchema>

export const testHistorySchema = z.object({
  testKey: z.string(),
  title: z.string(),
  titlePath: z.array(z.string()),
  file: z.string(),
  projectName: z.string(),
  codeOwners: z.array(z.string()).optional(),
  // Component stories the test mounted in its most recent run (see lib/story). Absent for non-component tests.
  stories: z.array(z.string()).optional(),
  // Accessibility check of its most recent run that executed (see lib/a11y). Absent without one.
  a11y: a11yReportSchema.optional(),
  points: z.array(testPointSchema),
  runs: z.number(),
  passed: z.number(),
  failed: z.number(),
  flaky: z.number(),
  skipped: z.number(),
  executed: z.number(),
  flakyRate: z.number(),
  failRate: z.number(),
  passRate: z.number(),
  // Same rates but over the last RECENT_WINDOW runs (sliding window), plus flags
  // for tests that only started flaking / failing inside that window.
  recentFlakyRate: z.number(),
  recentFailRate: z.number(),
  newlyFlaky: z.boolean(),
  newlyBroken: z.boolean(),
  lastStatus: pwTestStatus,
})
export type TestHistory = z.infer<typeof testHistorySchema>

// Failing occurrences grouped by error signature (see lib/fingerprint), for "top failure causes".
export const failureClusterSchema = z.object({
  fingerprint: z.string(),
  title: z.string(),
  sample: z.string(),
  count: z.number(),
  tests: z.number(),
  testKeys: z.array(z.string()),
  files: z.array(z.string()),
  lastSeen: z.string(),
})
export type FailureCluster = z.infer<typeof failureClusterSchema>

export const projectHistorySchema = z.object({
  project: projectEntrySchema.nullable(),
  histories: z.array(testHistorySchema),
  clusters: z.array(failureClusterSchema),
})
export type ProjectHistory = z.infer<typeof projectHistorySchema>

// Run-to-run comparison: per-test change between two runs, joined by testKey.
export const testChangeSchema = z.enum([
  'broken',
  'fixed',
  'newly-flaky',
  'still-failing',
  'added',
  'removed',
  'unchanged',
])
export type TestChange = z.infer<typeof testChangeSchema>

export const testDeltaSchema = z.object({
  testKey: z.string(),
  title: z.string(),
  titlePath: z.array(z.string()),
  file: z.string(),
  projectName: z.string(),
  change: testChangeSchema,
  baseStatus: pwTestStatus.nullable(),
  headStatus: pwTestStatus.nullable(),
  durationDelta: z.number(), // head - base, ms (0 if one side is missing)
})
export type TestDelta = z.infer<typeof testDeltaSchema>

const comparisonRunSchema = z.object({
  runId: z.string(),
  startedAt: z.string(),
  counts: countsSchema,
  git: gitMetaSchema.optional(),
})

export const runComparisonSchema = z.object({
  base: comparisonRunSchema,
  head: comparisonRunSchema,
  tests: z.array(testDeltaSchema),
})
export type RunComparison = z.infer<typeof runComparisonSchema>
