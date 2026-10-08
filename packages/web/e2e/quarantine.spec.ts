import { expect, test } from '@playwright/test'
import { login } from './helpers'

// A seeded test no other spec touches, so quarantining it can't bleed into parallel workers.
const PROJECT = 'marketing-site'
const TITLE = 'toggles annual billing'

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('quarantines a test, edits the reason, then lifts it from a run', async ({ page }) => {
  const quarantinedList = `/projects/${PROJECT}/tests?quarantined=true`

  await page.goto(`/projects/${PROJECT}/tests?unstable=false&q=${encodeURIComponent(TITLE)}`)
  await page.getByRole('link', { name: new RegExp(TITLE) }).click()

  // A CI retry after a mid-test failure can start from an already quarantined test.
  const toggle = page.getByRole('button', { name: /^(Unq|Q)uarantine$/ })
  if ((await toggle.textContent())?.trim() === 'Unquarantine') {
    await toggle.click()
    await expect(page.getByText('Test removed from quarantine')).toBeHidden({ timeout: 10_000 })
  }

  // Quarantine from the test's history page.
  await page.getByRole('button', { name: 'Quarantine', exact: true }).click()
  await expect(page.getByText('Test quarantined')).toBeVisible()
  await expect(page.getByText(/Quarantined since/)).toBeVisible()

  const save = page.getByRole('button', { name: 'Save reason' })
  await expect(save).toBeDisabled()
  await page.getByPlaceholder('Add a reason for the team...').fill('flaky on webkit')
  await save.click()
  await expect(page.getByText('Quarantine updated')).toBeVisible()
  await expect(save).toBeDisabled()

  // The reason survives a reload, and the Tests page lists the test as quarantined.
  await page.reload()
  await expect(page.getByPlaceholder('Add a reason for the team...')).toHaveValue('flaky on webkit')
  const runHref = await page.locator('a[href*="/runs/"]').last().getAttribute('href')
  await page.goto(quarantinedList)
  await expect(page.getByRole('link', { name: new RegExp(TITLE) })).toContainText('Quarantined')

  // Lift it from a run page, the other place that edits quarantine.
  expect(runHref).toBeTruthy()
  await page.goto(runHref!)
  await page.getByRole('button', { name: 'Unquarantine' }).click()
  await expect(page.getByText('Test removed from quarantine')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Unquarantine' })).toHaveCount(0)

  await page.goto(quarantinedList)
  await expect(page.getByText('No quarantined tests.')).toBeVisible()
})
