import path from 'node:path'
import { defineConfig } from 'vite'

// Bundles the vendored service worker into a single classic script served
// statically from public/sw.bundle.js (scope = app root).
const alias = {
  '@trace': path.resolve(import.meta.dirname, 'src/core/trace'),
  '@isomorphic': path.resolve(import.meta.dirname, 'src/core/isomorphic'),
  '@protocol': path.resolve(import.meta.dirname, 'src/core/protocol'),
}

export default defineConfig({
  publicDir: false,
  resolve: { alias },
  build: {
    outDir: 'public',
    emptyOutDir: false,
    rollupOptions: {
      input: path.resolve(import.meta.dirname, 'src/sw-main.ts'),
      output: {
        entryFileNames: 'sw.bundle.js',
        format: 'iife',
        inlineDynamicImports: true,
      },
    },
  },
})
