import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'
import pkg from '../../package.json' with { type: 'json' }

// Release version = the root package.json, the one the Release workflow bumps.
const release = `@kinora/trace-viewer@${pkg.version}`

// Aliases mirror upstream Playwright so vendored engine files resolve unedited.
const alias = {
  '@trace': path.resolve(import.meta.dirname, 'src/core/trace'),
  '@isomorphic': path.resolve(import.meta.dirname, 'src/core/isomorphic'),
  '@protocol': path.resolve(import.meta.dirname, 'src/core/protocol'),
  '@': path.resolve(import.meta.dirname, 'src'),
}

// The service worker keeps loaded traces in memory keyed by URL, so the demo URL carries
// the fixture's content hash: a regenerated demo.zip is a new key (and a new HTTP cache entry).
const demoTraceVersion = createHash('sha1')
  .update(readFileSync(path.resolve(import.meta.dirname, 'public/fixtures/demo.zip')))
  .digest('hex')
  .slice(0, 8)

export default defineConfig(({ command }) => ({
  // Prod build is served by the dashboard under /trace/; dev runs at root.
  base: command === 'build' ? '/trace/' : '/',
  // Dedicated port so the service worker always lives on its own origin,
  // separate from the dashboard app (5173).
  server: { port: 5174 },
  plugins: [
    vue(),
    tailwindcss(),
    // Uploads source maps + injects debug IDs to the consumer's Sentry project (web or desktop).
    // Skipped (no-op) without an auth token, e.g. self-host.
    process.env.SENTRY_AUTH_TOKEN
      ? sentryVitePlugin({
          org: process.env.SENTRY_ORG,
          project: process.env.SENTRY_PROJECT,
          authToken: process.env.SENTRY_AUTH_TOKEN,
          release: { name: release },
          // Delete maps after upload so they never ship in the nginx image or the packaged app.
          sourcemaps: { filesToDeleteAfterUpload: ['./dist/**/*.map'] },
        })
      : undefined,
  ],
  define: {
    __DEMO_TRACE_VERSION__: JSON.stringify(demoTraceVersion),
    __KINORA_RELEASE__: JSON.stringify(release),
  },
  resolve: { alias },
  build: {
    outDir: 'dist',
    // Maps emitted only for the Sentry upload; the plugin deletes them after, so none ship to users.
    sourcemap: process.env.SENTRY_AUTH_TOKEN ? 'hidden' : false,
  },
}))
