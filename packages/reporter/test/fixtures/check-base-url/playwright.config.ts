import process from 'node:process'
import { defineConfig } from '@playwright/test'

// Nested run launched by test/check-base-url.test.ts. No browser: the check runs before any
// worker, and the test only proves that the run got past it.
export default defineConfig({
  testDir: '.',
  testMatch: '*.check.ts',
  outputDir: process.env.CHECK_OUTPUT_DIR,
  globalSetup: ['../../../src/check-base-url.ts'],
  reporter: 'line',
  use: { baseURL: process.env.CHECK_BASE_URL },
})
