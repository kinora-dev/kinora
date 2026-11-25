import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cluster_triage', (t) => {
    t.timestamp('regression_notified_at', { useTz: false })
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('cluster_triage', (t) => {
    t.dropColumn('regression_notified_at')
  })
}
