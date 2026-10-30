import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('run', (t) => {
    t.index(['project_id', 'started_at', 'id'], 'run_project_started_idx')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('run', (t) => {
    t.dropIndex(['project_id', 'started_at', 'id'], 'run_project_started_idx')
  })
}
