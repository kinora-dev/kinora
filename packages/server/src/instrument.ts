import * as Sentry from '@sentry/node'
import { env } from './lib/env'
import { version } from './lib/version'

if (env.KINORA_CLOUD && env.NODE_ENV === 'production' && env.SENTRY_DSN) {
  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: 'production',
    release: `@kinora/server@${version}`,
    tracesSampleRate: 0.1,
    // sendDefaultPii was removed in Sentry v11; dataCollection now defaults to collecting everything, so opt back into the v10 restrictive posture explicitly.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
      databaseQueryData: false,
      queues: false,
      stackFrameVariables: false,
    },
    beforeSend(event) {
      // kinora ingests customer DOM/network/test data; never let request bodies or auth reach Sentry.
      if (event.request) {
        delete event.request.data
        delete event.request.cookies
        const headers = event.request.headers
        if (headers) {
          for (const k of Object.keys(headers)) {
            if (/^(?:authorization|cookie|x-api-key)$/i.test(k))
              delete headers[k]
          }
        }
      }
      return event
    },
  })
}
