import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import { GALLERY_PORT } from './vite.gallery.config.ts'

const ci = !!process.env.CI
const gallery = `http://localhost:${GALLERY_PORT}/`

// Component tests: each one mounts a story from the gallery page (playwright/gallery) through
// Playwright's `mount` fixture. Needs no server or database, only the gallery's Vite dev server.
export default defineConfig({
  testDir: './tests/components',
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  webServer: {
    command: 'pnpm gallery',
    url: gallery,
    reuseExistingServer: !ci,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'components',
      // `mount` navigates to baseURL; reusing the context between tests keeps the suite fast.
      use: { ...devices['Desktop Chrome'], baseURL: gallery, reuseContext: true, trace: 'on-first-retry' },
    },
  ],
})
