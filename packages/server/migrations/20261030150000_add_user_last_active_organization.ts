import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user', (t) => {
    t.text('last_active_organization_id')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user', (t) => {
    t.dropColumn('last_active_organization_id')
  })
}
