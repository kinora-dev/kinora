import path from 'node:path'
import process from 'node:process'
import { ValidateEnv } from '@julr/vite-plugin-validate-env'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import { z } from 'zod'
import pkg from '../../package.json' with { type: 'json' }

// Release version = the root package.json, the one the Release workflow bumps.
const release = `@kinora/web@${pkg.version}`
// Unique per build (cloud deploys main without a version bump): an open tab compares it to
// /version.json to notice a deploy (src/lib/updates.ts).
const build = Date.now().toString(36)

export default defineConfig({
  define: { __KINORA_RELEASE__: JSON.stringify(release), __KINORA_BUILD__: JSON.stringify(build) },
  build: {
    // Maps emitted only for the Sentry upload; the plugin deletes them after, so none ship to users.
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
  },
  plugins: [
    ValidateEnv({
      validator: 'standard',
      schema: {
        // Empty or unset = same origin, which is how the self-host image runs (nginx proxies the API).
        VITE_KINORA_SERVER_URL: z.union([z.url(), z.literal('')]).optional(),
        VITE_KINORA_VIEWER_URL: z.string().optional(),
        VITE_KINORA_CLOUD: z.string().optional(),
        VITE_KINORA_SENTRY_DSN: z.string().optional(),
        VITE_UMAMI_WEBSITE_ID: z.string().optional(),
      },
    }),
    vue(),
    tailwindcss(),
    {
      name: 'kinora-version',
      apply: 'build',
      generateBundle() {
        this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build }) })
      },
    },
    // Uploads source maps + injects debug IDs. Skipped (no-op) without an auth token, e.g. self-host.
    process.env.SENTRY_AUTH_TOKEN
      ? sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          release: { name: release },
          // Delete maps after upload so they never ship in the nginx image.
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        })
      : undefined,
  ],
  server: { port: 5173 },
  resolve: {
    alias: {
      '@': path.resolve(new URL('./src', import.meta.url).pathname),
    },
  },
})
