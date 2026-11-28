import { randomUUID } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { createApiToken, findTwoRuns, login, runOf, SERVER_URL, testOf } from './helpers'

test.beforeEach(async ({ page }) => {
  await login(page)
})

test('compares two runs of a project', async ({ page }) => {
  const { slug, base, head } = await findTwoRuns(page)
  await page.goto(`/projects/${slug}/compare?base=${base}&head=${head}`)

  await expect(page.getByRole('heading', { name: 'Run comparison' })).toBeVisible()
  await expect(page.getByText('Pass rate')).toBeVisible()
})

test('the Compare button on a run links to the comparison', async ({ page }) => {
  const { slug, head } = await findTwoRuns(page)
  await page.goto(`/projects/${slug}/runs/${head}`)

  await page.getByRole('link', { name: /Compare/ }).click()
  await expect(page).toHaveURL(/\/compare\?/)
  await expect(page.getByRole('heading', { name: 'Run comparison' })).toBeVisible()
})

// Unchanged tests stay hidden, except those far slower than they usually are on the base's branch.
test('names the tests slower than usual, with their usual time', async ({ page }) => {
  const token = await createApiToken(page)
  const slug = `compare-${randomUUID().slice(0, 8)}`
  const post = async (hoursAgo: number, duration: number, branch: string) => {
    const tests = [{ ...testOf('tests/cart.spec.ts', 'adds to cart', 'expected'), duration }, testOf('tests/cart.spec.ts', 'empties the cart', 'expected')]
    const res = await page.request.post(`${SERVER_URL}/api/v1/runs?backfill=1`, { headers: { Authorization: `Bearer ${token}` }, data: runOf(slug, new Date(Date.now() - hoursAgo * 3_600_000), tests, { branch }) })
    return (await res.json() as { runId: string }).runId
  }
  let base = ''
  for (const [i, duration] of [1000, 1100, 900, 1000, 1050].entries())
    base = await post(10 - i, duration, 'main')
  const head = await post(1, 4000, 'feat/cart')

  await page.goto(`/projects/${slug}/compare?base=${base}&head=${head}`)
  await expect(page.getByRole('heading', { name: 'Slower than usual (1)' })).toBeVisible()
  await expect(page.getByRole('link', { name: /adds to cart/ })).toContainText('4.0s, usually 1.0s')
  await expect(page.getByRole('link', { name: /empties the cart/ })).toHaveCount(0)
})
