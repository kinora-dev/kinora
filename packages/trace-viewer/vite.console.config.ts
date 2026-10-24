import path from 'node:path'
import { defineConfig } from 'vite'

// Bundles Playwright's console API (`playwright.$`, ...) into one classic script, served
// statically from public/console-api.bundle.js and injected into popped-out snapshots.
const alias = {
  '@injected': path.resolve(import.meta.dirname, 'src/core/injected'),
  '@isomorphic': path.resolve(import.meta.dirname, 'src/core/isomorphic'),
  '@protocol': path.resolve(import.meta.dirname, 'src/core/protocol'),
  '@recorder': path.resolve(import.meta.dirname, 'src/core/recorder'),
}

export default defineConfig({
  publicDir: false,
  resolve: { alias },
  build: {
    outDir: 'public',
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'src/console-api-main.ts'),
      output: {
        entryFileNames: 'console-api.bundle.js',
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
})
