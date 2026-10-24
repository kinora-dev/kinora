import antfu from '@antfu/eslint-config'

export default antfu(
  {
    vue: true,
    typescript: true,
    astro: true,
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/.astro/**',
      // Vendored from microsoft/playwright (Apache-2.0): don't lint upstream code.
      'packages/trace-viewer/src/core/**',
      'packages/trace-viewer/src/sw/**',
      'packages/trace-viewer/src/sw-main.ts',
      'packages/trace-viewer/public/sw.bundle.js',
      'packages/trace-viewer/public/console-api.bundle.js',
    ],
  },
  {
    files: ['packages/desktop/**/*.ts'],
    rules: {
      'node/prefer-global/process': 'off',
    },
  },
)
