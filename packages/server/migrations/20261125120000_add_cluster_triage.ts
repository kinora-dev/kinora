import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable('cluster_triage', (t) => {
    t.text('id').primary()
    t.text('project_id').notNullable().references('id').inTable('project').onDelete('CASCADE')
    t.text('fingerprint').notNullable()
    t.text('status').notNullable().defaultTo('open')
    t.text('assignee_user_id').references('id').inTable('user').onDelete('SET NULL')
    t.text('issue_url')
    t.text('note')
    t.timestamp('snoozed_at', { useTz: false })
    t.timestamp('snoozed_until', { useTz: false })
    t.timestamp('resolved_at', { useTz: false })
    t.text('resolved_by_user_id').references('id').inTable('user').onDelete('SET NULL')
    t.text('updated_by_user_id').references('id').inTable('user').onDelete('SET NULL')
    t.timestamp('created_at', { useTz: false }).notNullable().defaultTo(knex.fn.now())
    t.timestamp('updated_at', { useTz: false }).notNullable().defaultTo(knex.fn.now())
    t.unique(['project_id', 'fingerprint'], { indexName: 'cluster_triage_project_fingerprint_uniq' })
    t.index(['assignee_user_id'], 'cluster_triage_assignee_idx')
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists('cluster_triage')
}
