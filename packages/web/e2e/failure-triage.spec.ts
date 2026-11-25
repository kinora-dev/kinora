import { expect, test } from '@playwright/test'
import { createApiToken, login, postRun, runOf, testOf } from './helpers'

const MINUTE = 60 * 1000

test('triages a failure cause: assigned from the tests page, resolved from the inbox, back when it regresses', async ({ page }) => {
  await login(page)
  const token = await createApiToken(page)
  const stamp = Date.now()
  // Its own project and error, so parallel specs never share the cluster.
  const slug = `triage-${stamp}`
  const message = `Error: checkout total is wrong ${stamp}`
  const failing = () => ({ ...testOf('checkout.spec.ts', 'shows the total', 'unexpected'), errors: [{ message }] })
  await postRun(page, token, runOf(slug, new Date(stamp - MINUTE), [failing()]))

  await page.goto(`/projects/${slug}/tests`)
  const cluster = page.getByTestId('failure-cluster').filter({ hasText: message })
  await cluster.getByRole('button', { name: new RegExp(message) }).click()
  await cluster.getByRole('button', { name: 'Assign' }).click()
  await page.getByRole('menuitem', { name: 'Assign to me' }).click()
  await expect(page.getByText('Assigned to you')).toBeVisible()

  await page.goto('/?queue=mine')
  const row = page.getByTestId('inbox-cluster').filter({ hasText: message })
  await expect(row).toContainText(slug)
  await row.getByRole('button', { name: 'Resolve' }).click()
  await expect(page.getByText('Failure resolved')).toBeVisible()
  await expect(row).toHaveCount(0)

  // A failure in a run started after the resolution reopens it as a regression.
  await postRun(page, token, runOf(slug, new Date(Date.now() + MINUTE), [failing()]))
  await page.goto('/?queue=regressed')
  await expect(row.getByText('Regressed')).toBeVisible()
})
