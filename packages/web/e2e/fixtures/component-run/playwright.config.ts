import process from 'node:process'
import { defineConfig } from '@playwright/test'

// Nested run launched by e2e/component-run.spec.ts: real component tests, uploaded by the real
// reporter. Both are loaded from source so the suite needs no prior build of @kinora/reporter.
export default defineConfig({
  testDir: '.',
  // Not `.spec.ts`, so the outer e2e run never collects these.
  testMatch: '*.ct.ts',
  outputDir: process.env.CT_OUTPUT_DIR,
  retries: 1,
  reporter: [['../../../../reporter/src/index.ts', { project: { slug: process.env.CT_PROJECT_SLUG } }]],
  projects: [{ name: 'components', use: { baseURL: new URL('./gallery.html', import.meta.url).href } }],
})
