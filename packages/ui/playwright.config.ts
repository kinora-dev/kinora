import process from 'node:process'
import { defineConfig, devices } from '@playwright/test'
import { GALLERY_PORT } from './vite.gallery.config.ts'

const ci = !!process.env.CI
// Set by scripts/visual.mjs: the browser then runs in Docker and reaches the gallery on the host.
const visual = !!process.env.KINORA_VISUAL
const gallery = `http://localhost:${GALLERY_PORT}/`
const chrome = devices['Desktop Chrome']

// Component tests: each one mounts a story from the gallery page (playwright/gallery) through
// Playwright's `mount` fixture. Needs no server or database, only the gallery's Vite dev server.
export default defineConfig({
  fullyParallel: true,
  forbidOnly: ci,
  retries: ci ? 2 : 0,
  reporter: ci ? [['github'], ['html', { open: 'never' }]] : 'list',
  // One reference image per screenshot, whatever the host OS: the Docker browser renders them all.
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  webServer: {
    // --force: rebuild Vite's dependency cache up front. A stale cache makes Vite discover new
    // dependencies while the first tests run and reload the page, which drops `window.mount`.
    command: 'pnpm gallery --force',
    url: gallery,
    reuseExistingServer: !ci && !visual,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'components',
      testDir: './tests/components',
      // `mount` navigates to baseURL; reusing the context between tests keeps the suite fast.
      use: { ...chrome, baseURL: visual ? `http://host.docker.internal:${GALLERY_PORT}/` : gallery, reuseContext: true, trace: 'on-first-retry' },
    },
    // Screenshot assertions. Listed only under scripts/visual.mjs (`pnpm test:visual`): compared
    // against a browser other than the Docker one, every reference image would mismatch.
    ...visual
      ? [{
          name: 'visual',
          testDir: './tests/visual',
          use: { ...chrome, baseURL: `http://host.docker.internal:${GALLERY_PORT}/`, reuseContext: true },
        }]
      : [],
  ],
})
