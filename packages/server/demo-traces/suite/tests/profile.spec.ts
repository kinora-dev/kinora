import { Buffer } from 'node:buffer'
import { devices } from '@playwright/test'
import { expect, test } from './fixtures'

const { defaultBrowserType: _, ...iPhone } = devices['iPhone 15']
test.use({ ...iPhone, baseURL: 'https://pulse.demo.kinora.dev' })

const avatar = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 96 96">
  <defs><linearGradient id="g" x2="1" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#ea580c"/></linearGradient></defs>
  <rect width="96" height="96" fill="url(#g)"/><circle cx="48" cy="38" r="16" fill="#fff7ed"/><path d="M18 90a30 30 0 0 1 60 0z" fill="#fff7ed"/>
</svg>`

test('uploads an avatar', async ({ page }) => {
  await page.goto('/profile')
  await expect(page.getByRole('heading', { name: 'Alex Morgan' })).toBeVisible()

  await page.getByLabel('Change photo').setInputFiles({ name: 'avatar.svg', mimeType: 'image/svg+xml', buffer: Buffer.from(avatar) })

  await expect(page.getByRole('status')).toHaveText('Profile photo updated')
  await expect(page.getByRole('img', { name: 'Alex Morgan' })).toBeVisible()
})
