import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('run', (t) => {
    t.jsonb('base_urls')
    t.jsonb('incident')
    t.jsonb('incident_decision')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('run', (t) => {
    t.dropColumn('incident_decision')
    t.dropColumn('incident')
    t.dropColumn('base_urls')
  })
}
