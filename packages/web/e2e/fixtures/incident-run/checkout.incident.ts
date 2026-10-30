import process from 'node:process'
import { expect, test } from '@playwright/test'

const scenario = process.env.INCIDENT_SCENARIO

for (const path of ['/', '/cart', '/checkout']) {
  test(`${path} loads`, async ({ page, request }) => {
    if (scenario === 'request') {
      // The request fixture fails in Node, not in the browser.
      expect((await request.get(path)).ok()).toBe(true)
    }
    else if (scenario === 'assertions') {
      // The app answers, the page is just wrong: a regression, never an incident.
      await page.setContent('<h1>Maintenance</h1>')
      await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible({ timeout: 500 })
    }
    else {
      await page.goto(path)
    }
  })
}
