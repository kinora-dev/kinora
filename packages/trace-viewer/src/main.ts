import * as Sentry from '@sentry/vue'
import { createApp } from 'vue'
import { envelopeUrl, scrubBreadcrumb, scrubEvent } from './ui/lib/sentry'
import Workbench from './ui/Workbench.vue'
import './style.css'

const app = createApp(Workbench)

// DSN baked per consumer build (web -> frontend project, desktop -> desktop project); absent in self-host/dev -> tree-shaken.
if (import.meta.env.PROD && import.meta.env.VITE_KINORA_SENTRY_DSN) {
  Sentry.init({
    app,
    dsn: import.meta.env.VITE_KINORA_SENTRY_DSN,
    tunnel: envelopeUrl(import.meta.env.VITE_KINORA_SENTRY_DSN),
    environment: 'production',
    release: __KINORA_RELEASE__,
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
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
  })
}

app.mount('#app')
