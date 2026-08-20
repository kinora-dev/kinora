import { DEFAULT_KINORA_URL } from '@kinora/core'

// Build-time config from VITE_KINORA_* env (see .env.example / docker build args).
const DEV = import.meta.env.DEV
// No server URL baked in = same origin: the self-host web image proxies /api, /trpc and /artifacts itself.
const sameOrigin = typeof window === 'undefined' ? '' : window.location.origin

export const env = {
  serverUrl: import.meta.env.VITE_KINORA_SERVER_URL || sameOrigin,
  // Trace viewer: own dev server in dev, served under /trace/ in prod.
  viewerBaseUrl: import.meta.env.VITE_KINORA_VIEWER_URL || (DEV ? 'http://localhost:5174/' : '/trace/'),
  sentryDsn: import.meta.env.VITE_KINORA_SENTRY_DSN,
}

export const isSelfHost = env.serverUrl !== DEFAULT_KINORA_URL
