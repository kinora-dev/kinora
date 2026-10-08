import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// Dev server for the component gallery (playwright/gallery): the page Playwright's `mount`
// fixture drives. Not a build target, @kinora/ui is consumed as source by the apps.
export const GALLERY_PORT = 5398

export default defineConfig({
  root: 'playwright/gallery',
  plugins: [vue(), tailwindcss()],
  server: { port: GALLERY_PORT, strictPort: true },
})
