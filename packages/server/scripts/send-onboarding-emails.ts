/* eslint-disable perfectionist/sort-imports -- ../src/instrument must load first so Sentry inits before other modules */
import '../src/instrument'
import * as Sentry from '@sentry/node'
import process from 'node:process'
import { env } from '../src/lib/env'
import { logger } from '../src/lib/logger'
import { sendOnboardingEmails } from '../src/onboarding/emails'

async function main(): Promise<void> {
  // A self-hosted instance never mails its users on its own.
  if (!env.KINORA_CLOUD) {
    logger.info('send-onboarding-emails skipped: not a cloud deployment')
    return
  }
  const { checked, sent, undelivered } = await sendOnboardingEmails()
  logger.info({ checked, sent, undelivered }, 'send-onboarding-emails complete')
  if (undelivered > 0)
    Sentry.captureMessage('send-onboarding-emails could not deliver onboarding emails', { level: 'error', tags: { area: 'onboarding' }, extra: { checked, sent, undelivered } })
}

main()
  .then(async () => {
    // Sentry sends in the background; exiting right away would drop what the job just reported.
    await Sentry.flush(2000)
    process.exit(0)
  })
  .catch(async (error) => {
    logger.error({ error }, 'send-onboarding-emails failed')
    Sentry.captureException(error, { tags: { area: 'onboarding' } })
    await Sentry.flush(2000)
    process.exit(1)
  })
