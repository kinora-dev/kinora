import type { Knex } from 'knex'

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user', (t) => {
    t.integer('onboarding_email_step').notNullable().defaultTo(0)
    t.boolean('onboarding_emails_enabled').notNullable().defaultTo(true)
  })
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable('user', (t) => {
    t.dropColumn('onboarding_emails_enabled')
    t.dropColumn('onboarding_email_step')
  })
}
