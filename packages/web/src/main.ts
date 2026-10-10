import * as Sentry from '@sentry/vue'
import { createApp } from 'vue'
import App from './App.vue'
import { initAnalytics } from './lib/analytics'
import { env } from './lib/env'
import { watchForUpdates } from './lib/updates'
import { router } from './router'
import './style.css'

initAnalytics()

const app = createApp(App)

if (import.meta.env.PROD && import.meta.env.VITE_KINORA_CLOUD === 'true' && env.sentryDsn) {
  Sentry.init({
    app,
    dsn: env.sentryDsn,
    environment: 'production',
    release: __KINORA_RELEASE__,
    integrations: [Sentry.browserTracingIntegration({ router })],
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  })
}

if (import.meta.env.PROD)
  watchForUpdates(router, __KINORA_BUILD__)

app.use(router).mount('#app')
