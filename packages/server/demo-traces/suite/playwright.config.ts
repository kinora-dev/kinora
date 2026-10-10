import { defineConfig, devices } from '@playwright/test'

// The suite behind the demo's traces (`pnpm demo-traces:generate`). Paths and titles
// mirror tests in scripts/seed-market.ts, so a seeded test opens its own trace.
export default defineConfig({
  testDir: '.',
  retries: 0,
  reporter: [['list'], ['json', { outputFile: 'results.json' }]],
  expect: { timeout: 2000 },
  use: {
    ...devices['Desktop Chrome'],
    trace: 'on',
  },
  projects: [{ name: 'chromium' }],
})
