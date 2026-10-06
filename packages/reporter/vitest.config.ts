import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      reporter: ['text-summary', 'text', 'html'],
      thresholds: {
        statements: 80,
        branches: 65,
        functions: 80,
        lines: 80,
      },
    },
  },
})
