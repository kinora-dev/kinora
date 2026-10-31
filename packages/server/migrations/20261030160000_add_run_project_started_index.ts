import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('run', (t) => {
    t.index(['project_id', 'started_at', 'id'], 'run_project_started_idx')
    t.dropIndex(['project_id'], 'run_projectId_idx')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('run', (t) => {
    t.index(['project_id'], 'run_projectId_idx')
    t.dropIndex(['project_id', 'started_at', 'id'], 'run_project_started_idx')
  })
}
