/* eslint-disable perfectionist/sort-imports -- ./instrument must load first so Sentry inits before other modules */
import './instrument'
import { serve } from '@hono/node-server'
import process from 'node:process'
import { app } from './app'
import { purgeExpiredRuns } from './billing/retention'
import { db } from './db'
import { demo, env, retentionPolicy } from './lib/env'
import { logger } from './lib/logger'
import { closeStaleOpenRuns, SHARD_SWEEP_INTERVAL_MS } from './public-api/shard-sweep'

// Log stray rejections instead of letting one crash the whole server; uncaught exceptions leave the
// process in an undefined state, so exit and let the orchestrator restart cleanly.
process.on('unhandledRejection', reason => logger.error({ reason }, 'unhandled promise rejection'))
process.on('uncaughtException', (err) => {
  logger.error({ err }, 'uncaught exception')
  process.exit(1)
})

const server = serve({ fetch: app.fetch, port: env.PORT }, (info) => {
  logger.info(`${demo ? '[DEMO] ' : ''}kinora server running on port ${info.port}`)
})

// Self-host ships no scheduler, so sweep in-process. Cloud leaves retentionPolicy null and
// keeps sweeping from its own cron (safe with several replicas).
if (retentionPolicy) {
  const sweep = (): void => void purgeExpiredRuns(new Date())
    .then(result => logger.info(result, 'retention sweep complete'))
    .catch(error => logger.error({ err: error }, 'retention sweep failed'))

  sweep()
  setInterval(sweep, 24 * 60 * 60 * 1000).unref()
}

// Both modes: the update claims each run, so several replicas sweeping at once notify it once.
function shardSweep(): void {
  return void closeStaleOpenRuns(new Date())
    .then(result => result.closed && logger.info(result, 'incomplete shard runs closed'))
    .catch(error => logger.error({ err: error }, 'shard sweep failed'))
}
setInterval(shardSweep, SHARD_SWEEP_INTERVAL_MS).unref()

let shuttingDown = false
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown)
    return
  shuttingDown = true
  logger.info({ signal }, 'shutting down')
  // Never hang on a stuck keep-alive connection; the orchestrator SIGKILLs after its grace period anyway.
  setTimeout(() => process.exit(1), 10_000).unref()
  await new Promise<void>(resolve => server.close(() => resolve()))
  await db.$client.end().catch(err => logger.error({ err }, 'pool close failed'))
  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
