import type { Counts, IncidentDecision, NormTest, RunIncident, RunReport, RunStatus } from '@kinora/core'
import { relations, sql } from 'drizzle-orm'
import { boolean, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, uniqueIndex } from 'drizzle-orm/pg-core'
import { organization, user } from './auth-schemas'

type GitMeta = NonNullable<RunReport['meta']['git']>
type CiMeta = NonNullable<RunReport['meta']['ci']>

// A filled shard slot of a grouped run. `results` and `metered` belong to the slot's first landing:
// a re-run replaces the tests but is neither counted nor billed again.
export interface ShardSlot {
  attempt: number
  landedAt: string
  startedAt: string
  duration: number
  results: number
  metered: boolean
}

export const project = pgTable('project', {
  id: text('id').primaryKey(),
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  description: text('description'),
  codeownersSource: text('codeowners_source').$type<'manual'>().notNull().default('manual'),
  codeownersText: text('codeowners_text'),
  codeownersSyncedAt: timestamp('codeowners_synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [
  index('project_organizationId_idx').on(table.organizationId),
  unique('project_org_slug_uniq').on(table.organizationId, table.slug),
])

export const run = pgTable('run', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  startedAt: timestamp('started_at').notNull(),
  duration: integer('duration').notNull(),
  counts: jsonb('counts').$type<Counts>().notNull(),
  countsByTag: jsonb('counts_by_tag').$type<Record<string, Counts>>().notNull().default({}),
  playwrightVersion: text('playwright_version'),
  git: jsonb('git').$type<GitMeta>(),
  ci: jsonb('ci').$type<CiMeta>(),
  shards: integer('shards'),
  // Billable usage not yet acknowledged by Polar. Set in the ingest transaction and cleared once the
  // usage event is accepted, so a failed or interrupted report is retried by report-pending-usage.
  meterPending: boolean('meter_pending').notNull().default(false),
  // Direct shard uploads sharing a group key are assembled into this one run (null: single upload).
  groupKey: text('group_key'),
  shardsTotal: integer('shards_total'),
  // Shard index (1-based, as a string) -> the slot's latest landing.
  shardsLanded: jsonb('shards_landed').$type<Record<string, ShardSlot>>().notNull().default({}),
  status: text('status').$type<RunStatus>().notNull().default('complete'),
  // Alerts fired for this run; a grouped run notifies once, on completion or when closed incomplete.
  notifiedAt: timestamp('notified_at'),
  // Client-sent Idempotency-Key: a retried upload whose response was lost maps back to this run.
  idempotencyKey: text('idempotency_key'),
  // The `baseURL`s the upload declared, kept for judging a grouped run once its last shard lands.
  baseUrls: jsonb('base_urls').$type<string[]>(),
  // Set when the run is an environment incident (null: the run counts). See @kinora/core lib/incident.
  incident: jsonb('incident').$type<RunIncident>(),
  incidentDecision: jsonb('incident_decision').$type<IncidentDecision>(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  index('run_projectId_idx').on(table.projectId),
  index('run_project_started_idx').on(table.projectId, table.startedAt, table.id),
  uniqueIndex('run_project_idempotency_uniq').on(table.projectId, table.idempotencyKey).where(sql`idempotency_key is not null`),
  uniqueIndex('run_project_groupkey_uniq').on(table.projectId, table.groupKey).where(sql`group_key is not null`),
  index('run_open_idx').on(table.createdAt).where(sql`status = 'open'`),
])

export const test = pgTable('test', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  testKey: text('test_key').notNull(),
  title: text('title').notNull(),
  titlePath: jsonb('title_path').$type<string[]>().notNull(),
  file: text('file').notNull(),
  line: integer('line').notNull(),
  column: integer('column').notNull(),
  projectName: text('project_name').notNull(),
  status: text('status').$type<NormTest['status']>().notNull(),
  ok: boolean('ok').notNull(),
  duration: integer('duration').notNull(),
  retries: integer('retries').notNull(),
  tags: jsonb('tags').$type<string[]>().notNull(),
  annotations: jsonb('annotations').$type<NormTest['annotations']>().notNull(),
  errors: jsonb('errors').$type<NormTest['errors']>().notNull(),
  attachments: jsonb('attachments').$type<NormTest['attachments']>().notNull(),
  a11y: jsonb('a11y').$type<NormTest['a11y']>(),
  // Slot of a grouped run this test came from; a re-run of the shard replaces these rows.
  shardIndex: integer('shard_index'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  index('test_runId_idx').on(table.runId),
  index('test_project_key_idx').on(table.projectId, table.testKey),
])

export const artifact = pgTable('artifact', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  runId: text('run_id').notNull().references(() => run.id, { onDelete: 'cascade' }),
  testId: text('test_id').references(() => test.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  contentType: text('content_type').notNull(),
  storageKey: text('storage_key').notNull(),
  sha1: text('sha1'),
  size: integer('size'),
  // Same role as run.idempotencyKey: a retried upload whose response was lost maps back here.
  idempotencyKey: text('idempotency_key'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, table => [
  index('artifact_runId_idx').on(table.runId),
  uniqueIndex('artifact_run_idempotency_uniq').on(table.runId, table.idempotencyKey).where(sql`idempotency_key is not null`),
  index('artifact_projectId_idx').on(table.projectId),
  index('artifact_testId_idx').on(table.testId),
])

export const testQuarantine = pgTable('test_quarantine', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  testKey: text('test_key').notNull(),
  reason: text('reason'),
  expiresAt: timestamp('expires_at'),
  createdByUserId: text('created_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  updatedByUserId: text('updated_by_user_id').references(() => user.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [
  index('test_quarantine_projectId_idx').on(table.projectId),
  unique('test_quarantine_project_key_uniq').on(table.projectId, table.testKey),
])

// Cached Polar billing state, synced from the customer.state_changed webhook.
export const subscription = pgTable('subscription', {
  organizationId: text('organization_id').primaryKey().references(() => organization.id, { onDelete: 'cascade' }),
  polarCustomerId: text('polar_customer_id').notNull(),
  tier: text('tier').$type<'free' | 'team' | 'pro' | 'enterprise'>().notNull().default('free'),
  status: text('status'),
  productId: text('product_id'),
  currentPeriodEnd: timestamp('current_period_end'),
  cancelAtPeriodEnd: boolean('cancel_at_period_end').notNull().default(false),
  // Polar event-occurrence time of the last applied state; lets us drop out-of-order webhooks.
  stateChangedAt: timestamp('state_changed_at'),
  // Highest included-results threshold already emailed for the current billing cycle.
  usageAlertLevel: text('usage_alert_level').$type<'near' | 'reached'>(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
})

// Test results ingested per org per calendar month (UTC, 'YYYY-MM'). A counter rather than a count
// over `test`, so retention purges and deleted projects never hand quota back.
export const usagePeriod = pgTable('usage_period', {
  organizationId: text('organization_id').notNull().references(() => organization.id, { onDelete: 'cascade' }),
  period: text('period').notNull(),
  results: integer('results').notNull().default(0),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [primaryKey({ columns: [table.organizationId, table.period] })])

// One Slack channel per project for run/regression notifications.
export const slackIntegration = pgTable('slack_integration', {
  projectId: text('project_id').primaryKey().references(() => project.id, { onDelete: 'cascade' }),
  webhookUrl: text('webhook_url').notNull(),
  // Set when connected via OAuth (incoming_webhook.channel / team_name); null for manual webhook paste.
  channel: text('channel'),
  teamName: text('team_name'),
  policy: text('policy').$type<'always' | 'on-failure' | 'on-regression'>().notNull().default('on-failure'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
})

// Email / webhook alert channels. Slack stays separate (it carries OAuth specifics); a project
// can have many of these. target = email address or webhook URL depending on kind.
export const alertChannel = pgTable('alert_channel', {
  id: text('id').primaryKey(),
  projectId: text('project_id').notNull().references(() => project.id, { onDelete: 'cascade' }),
  kind: text('kind').$type<'email' | 'webhook'>().notNull(),
  target: text('target').notNull(),
  policy: text('policy').$type<'always' | 'on-failure' | 'on-regression'>().notNull().default('on-failure'),
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().$onUpdate(() => new Date()).notNull(),
}, table => [index('alert_channel_projectId_idx').on(table.projectId)])

export const projectRelations = relations(project, ({ one, many }) => ({
  organization: one(organization, { fields: [project.organizationId], references: [organization.id] }),
  runs: many(run),
}))

export const runRelations = relations(run, ({ one, many }) => ({
  project: one(project, { fields: [run.projectId], references: [project.id] }),
  tests: many(test),
  artifacts: many(artifact),
}))

export const testRelations = relations(test, ({ one, many }) => ({
  run: one(run, { fields: [test.runId], references: [run.id] }),
  project: one(project, { fields: [test.projectId], references: [project.id] }),
  artifacts: many(artifact),
}))

export const artifactRelations = relations(artifact, ({ one }) => ({
  run: one(run, { fields: [artifact.runId], references: [run.id] }),
  test: one(test, { fields: [artifact.testId], references: [test.id] }),
}))
