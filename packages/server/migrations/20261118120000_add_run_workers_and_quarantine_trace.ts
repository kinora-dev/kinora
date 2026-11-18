import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('run', (t) => {
    t.integer('workers')
  })
  await knex.schema.alterTable('test_quarantine', (t) => {
    t.text('pinned_trace_key')
    t.jsonb('pinned_trace')
    t.index(['pinned_trace_key'], 'test_quarantine_pinned_trace_key_idx')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('test_quarantine', (t) => {
    t.dropIndex(['pinned_trace_key'], 'test_quarantine_pinned_trace_key_idx')
    t.dropColumn('pinned_trace')
    t.dropColumn('pinned_trace_key')
  })
  await knex.schema.alterTable('run', (t) => {
    t.dropColumn('workers')
  })
}
