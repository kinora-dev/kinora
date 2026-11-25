import type { Knex } from 'knex'

// CONCURRENTLY can't run in a transaction; it keeps ingest writing to `test` while the index builds.
export const config = { transaction: false }

// Failure clusters read only the failing tests of a run window: without this index Postgres scans
// the whole `test` table for each project.
export async function up(knex: Knex): Promise<void> {
  // A build interrupted earlier leaves an invalid index behind.
  await knex.raw('drop index concurrently if exists test_failing_run_idx')
  await knex.raw(`create index concurrently test_failing_run_idx on test (run_id) where status in ('unexpected', 'flaky')`)
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('drop index concurrently if exists test_failing_run_idx')
}
