import process from 'node:process'
import { defineConfig } from '@playwright/test'

// Nested run launched by e2e/incident-run.spec.ts, once per outage scenario: real Playwright
// errors against an app that is down, uploaded by the real reporter (loaded from source).
export default defineConfig({
  testDir: '.',
  // Not `.spec.ts`, so the outer e2e run never collects these.
  testMatch: '*.incident.ts',
  outputDir: process.env.INCIDENT_OUTPUT_DIR,
  use: { baseURL: process.env.INCIDENT_BASE_URL },
  reporter: [['../../../../reporter/src/index.ts', { project: { slug: process.env.INCIDENT_PROJECT_SLUG } }]],
})
