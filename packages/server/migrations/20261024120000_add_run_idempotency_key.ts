import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('run', (t) => {
    t.text('idempotency_key')
  })
  await knex.raw('CREATE UNIQUE INDEX run_project_idempotency_uniq ON run (project_id, idempotency_key) WHERE idempotency_key IS NOT NULL')
  await knex.schema.alterTable('artifact', (t) => {
    t.text('idempotency_key')
  })
  await knex.raw('CREATE UNIQUE INDEX artifact_run_idempotency_uniq ON artifact (run_id, idempotency_key) WHERE idempotency_key IS NOT NULL')
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw('DROP INDEX IF EXISTS artifact_run_idempotency_uniq')
  await knex.schema.alterTable('artifact', (t) => {
    t.dropColumn('idempotency_key')
  })
  await knex.raw('DROP INDEX IF EXISTS run_project_idempotency_uniq')
  await knex.schema.alterTable('run', (t) => {
    t.dropColumn('idempotency_key')
  })
}
