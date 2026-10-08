import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { createApiToken, login, SERVER_URL } from './helpers'

const run = promisify(execFile)
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve('@playwright/test/cli')
const CONFIG = fileURLToPath(new URL('./fixtures/component-run/playwright.config.ts', import.meta.url))

// The whole chain, nothing seeded: Playwright component tests -> @kinora/reporter/ct ->
// reporter upload -> server -> Components page.
test('a real component run shows up on the components page', async ({ page }) => {
  await login(page)
  const slug = `ct-run-${Date.now()}`
  const outputDir = await mkdtemp(join(tmpdir(), 'kinora-ct-'))

  try {
    const { stdout } = await run(process.execPath, [PLAYWRIGHT_CLI, 'test', '-c', CONFIG], {
      env: {
        ...process.env,
        KINORA_URL: SERVER_URL,
        KINORA_TOKEN: await createApiToken(page),
        CT_PROJECT_SLUG: slug,
        CT_OUTPUT_DIR: outputDir,
      },
    })
    expect(stdout).toContain('[kinora] uploaded 2 tests')
  }
  finally {
    await rm(outputDir, { recursive: true, force: true })
  }

  await page.goto(`/projects/${slug}/components`)

  const button = page.getByRole('region', { name: 'Button' })
  await expect(button.getByText('2 stories')).toBeVisible()
  await expect(button.getByText('Primary', { exact: true })).toBeVisible()
  await expect(button.getByText('Disabled', { exact: true })).toBeVisible()
  await expect(button.getByRole('link', { name: /button states/ })).toHaveCount(2)

  // Mounted by its `Badge/Default` suffix, failed once then passed on retry: one flaky story.
  const badge = page.getByRole('region', { name: 'Badge' })
  await expect(badge.getByText('1 story')).toBeVisible()
  await expect(badge.getByRole('link', { name: /badge shows its label/ })).toHaveCount(1)
  await expect(badge.getByText('Flaky').first()).toBeVisible()
})
