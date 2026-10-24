import type { Page } from '@playwright/test'
import { expect, test } from '@playwright/test'

test.beforeEach(async ({ page }) => {
  await page.goto('/?trace=fixtures/demo.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
})

function ms(label: string | null): number {
  const m = label?.trim().match(/^([\d.]+)(ms|s)$/)
  expect(m, `unexpected time label "${label}"`).toBeTruthy()
  return Number(m![1]) * (m![2] === 's' ? 1000 : 1)
}

async function slowestSpeed(page: Page): Promise<void> {
  while ((await page.getByTestId('playback-speed').textContent())?.trim() !== '0.25x')
    await page.getByTestId('playback-speed').click()
}

test('ruler marks round durations from the trace start', async ({ page }) => {
  const ticks = page.getByTestId('ruler-tick')
  await expect(ticks.first()).toHaveText('0ms')
  expect(await ticks.count()).toBeGreaterThan(2)
  const [a, b, c] = await ticks.allTextContents()
  expect(ms(c) - ms(b)).toBe(ms(b) - ms(a))
})

test('pause keeps the playhead and resumes from it, stop rewinds', async ({ page }) => {
  const time = page.getByTestId('timeline-current-time')
  await page.getByTestId('action-scrubber').fill('0')
  await slowestSpeed(page)
  await page.getByTestId('play').click()
  await expect.poll(async () => ms(await time.textContent())).toBeGreaterThan(20)

  await page.getByTestId('play').click()
  await expect(page.getByTestId('play')).toHaveAttribute('title', 'Play')
  const paused = ms(await time.textContent())
  await page.waitForTimeout(300)
  expect(ms(await time.textContent())).toBe(paused)
  await expect(page.getByTestId('playback-frame')).toBeVisible()

  await page.getByTestId('play').click()
  await expect.poll(async () => ms(await time.textContent())).toBeGreaterThan(paused)
  expect(ms(await time.textContent())).toBeGreaterThanOrEqual(paused)

  await page.getByTestId('stop').click()
  await expect(page.getByTestId('play')).toHaveAttribute('title', 'Play')
  await expect(page.getByTestId('playback-frame')).toHaveCount(0)
  await expect(page.getByTestId('stop')).toBeDisabled()
})

test('scrubber moves through time and follows the running action', async ({ page }) => {
  await page.getByTestId('action').filter({ hasText: 'Fill "alex@example.com"' }).click()
  const fillStart = ms(await page.getByTestId('timeline-current-time').textContent())
  await page.getByTestId('action').filter({ hasText: 'Screenshot' }).first().click()

  // Off the action list: a hovered action previews its own snapshot over the frame.
  await page.getByTestId('action-scrubber').hover()
  await page.getByTestId('action-scrubber').fill(String(fillStart + 1))
  await expect(page.getByTestId('current-action')).toHaveText('Fill "alex@example.com"')
  await expect(page.getByTestId('timeline-current-time')).toHaveText(`${fillStart + 1}ms`)
  // The screencast follows the scrubber.
  await expect(page.getByTestId('playback-frame')).toBeVisible()
  expect(await page.getByTestId('scrubber-mark').count()).toBeGreaterThan(5)
})

test('film strip previews the frame under the pointer', async ({ page }) => {
  const row = page.getByTestId('filmstrip-row')
  await expect(row).toHaveCount(1)
  await row.hover()
  await expect(page.getByTestId('filmstrip-preview')).toBeVisible()
  await expect(page.getByTestId('filmstrip-preview')).toHaveAttribute('src', /file\//)
  await page.getByTestId('action').first().hover()
  await expect(page.getByTestId('filmstrip-preview')).toHaveCount(0)
})

test('film strip shows one row per page', async ({ page }) => {
  await page.goto('/?trace=fixtures/popup-trace.zip')
  await expect(page.getByTestId('action').first()).toBeVisible()
  await expect(page.getByTestId('filmstrip-row')).toHaveCount(2)
})

test('hovering a console or network row highlights its time on the timeline', async ({ page }) => {
  await page.getByRole('button', { name: /^Console/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await expect(page.getByTestId('timeline-highlight')).toHaveCount(0)
  await page.getByTestId('console-entry').first().hover()
  await expect(page.getByTestId('timeline-highlight')).toBeVisible()
  await page.getByTestId('timeline-current-time').hover()
  await expect(page.getByTestId('timeline-highlight')).toHaveCount(0)

  await page.getByRole('button', { name: /^Network/ }).click()
  await page.getByRole('button', { name: 'All', exact: true }).click()
  await page.getByTestId('net-row').first().hover()
  await expect(page.getByTestId('timeline-highlight')).toBeVisible()
})
