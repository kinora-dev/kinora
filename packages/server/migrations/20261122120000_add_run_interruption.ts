import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('run', (t) => {
    t.text('interruption')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('run', (t) => {
    t.dropColumn('interruption')
  })
}
