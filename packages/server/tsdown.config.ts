import { defineConfig } from 'tsdown'
import pkg from '../../package.json' with { type: 'json' }

export default defineConfig({
  entry: ['src/index.ts', 'scripts/migrate.ts', 'scripts/purge-expired-runs.ts', 'scripts/notify-usage-alerts.ts', 'scripts/send-onboarding-emails.ts', 'scripts/report-pending-usage.ts', 'scripts/reset-demo.ts', 'scripts/seed-market.ts', 'migrations/*.ts'],
  platform: 'node',
  format: 'esm',
  // Source maps so Sentry stack traces map back to TS (run with node --enable-source-maps).
  sourcemap: true,
  // Read by src/lib/version.ts (Sentry release, config.get, feedback reports).
  define: { __KINORA_VERSION__: JSON.stringify(pkg.version) },
  // Bundle the workspace lib (its in-repo exports point at TS source) so the
  // built server runs in prod without resolving @kinora/core from node_modules.
  deps: { alwaysBundle: ['@kinora/core'] },
})
