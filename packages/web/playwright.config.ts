import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'

const ci = !!process.env.CI

// Same self-booted, disposable stack in dev and CI: dedicated ports + a kinora_e2e DB,
// so locally the dev stack (3000/5173, dev DB) keeps running untouched. `db:reset:e2e`
// (run by the test:e2e script, before playwright) prepares the DB.
const SERVER_PORT = 3399
const WEB_PORT = 5399
const serverUrl = `http://localhost:${SERVER_PORT}`
const baseURL = `http://localhost:${WEB_PORT}`

// Single source for the server URL; e2e helpers read it for direct tRPC probes.
process.env.E2E_SERVER_URL = serverUrl

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  webServer: [
    {
      // Inline env so it reliably reaches the spawned process. .env file (dev) / job env (CI) fills the rest.
      // TRPC_RATE_LIMIT: every worker shares one IP, and the suite outgrew the default 300 req/min
      // (a throttled `user.me` reads as "signed out" and bounces the test to /login).
      // Dummy OAuth creds so the login page renders the social buttons (they're hidden when a provider is unconfigured).
      command: `PORT=${SERVER_PORT} BASE_URL=${serverUrl} WEB_ORIGIN=${baseURL} POSTGRES_DB=kinora_e2e KINORA_CLOUD=false TRPC_RATE_LIMIT=100000 GOOGLE_CLIENT_ID=e2e GOOGLE_CLIENT_SECRET=e2e GITHUB_CLIENT_ID=e2e GITHUB_CLIENT_SECRET=e2e pnpm --filter @kinora/server start`,
      url: `${serverUrl}/healthcheck`,
      reuseExistingServer: false,
      timeout: 120_000,
    },
    {
      command: `VITE_KINORA_SERVER_URL=${serverUrl} pnpm --filter @kinora/web exec vite --port ${WEB_PORT} --strictPort`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
  use: {
    baseURL,
    trace: 'on-first-retry',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
})
