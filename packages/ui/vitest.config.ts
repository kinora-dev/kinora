import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // `tests/components/*.spec.ts` are Playwright component tests (pnpm test:e2e), not vitest's.
    include: ['tests/**/*.test.ts'],
  },
})
