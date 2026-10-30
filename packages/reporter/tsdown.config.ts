import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: { 'index': 'src/index.ts', 'ct': 'src/ct.ts', 'a11y': 'src/a11y.ts', 'check-base-url': 'src/check-base-url.ts' },
  platform: 'node',
  format: 'esm',
  dts: true,
})
