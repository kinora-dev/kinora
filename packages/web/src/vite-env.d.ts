/// <reference types="vite/client" />

// Sentry release name + per-build id, injected by vite.config.ts (`define`).
declare const __KINORA_RELEASE__: string
declare const __KINORA_BUILD__: string

// Strict import.meta.env: only the keys declared below (+ Vite built-ins) are
// allowed; unknown VITE_* access becomes a type error.
interface ViteTypeOptions {
  strictImportMetaEnv: unknown
}

interface ImportMetaEnv {
  readonly VITE_KINORA_SERVER_URL?: string
  readonly VITE_KINORA_VIEWER_URL?: string
  readonly VITE_KINORA_CLOUD?: string
  readonly VITE_KINORA_SENTRY_DSN?: string
  readonly VITE_UMAMI_WEBSITE_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
