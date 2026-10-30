import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, test } from '@playwright/test'
import { createApiToken, login, SERVER_URL } from './helpers'

const run = promisify(execFile)
const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve('@playwright/test/cli')
const CONFIG = fileURLToPath(new URL('./fixtures/incident-run/playwright.config.ts', import.meta.url))

// A port nothing listens on: bound by the OS, then released.
async function closedPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address() as { port: number }
  await new Promise(resolve => server.close(resolve))
  return port
}

// The incident rules read Playwright's own error wording, so this runs real outages through
// Playwright -> @kinora/reporter -> server: a Playwright upgrade that rewords them fails here.
test('a real outage is flagged as an environment incident, failing assertions are not', async ({ page }) => {
  test.setTimeout(120_000)
  await login(page)
  const token = await createApiToken(page)
  const down = `http://localhost:${await closedPort()}`
  const stamp = Date.now()

  const scenarios = [
    { name: 'refused', baseURL: down, flagged: /navigating or connecting to localhost:\d+ \(connection refused\)/ },
    { name: 'dns', baseURL: 'http://kinora-e2e.invalid', flagged: /navigating or connecting to kinora-e2e\.invalid \(name not resolved\)/ },
    { name: 'request', baseURL: down, flagged: /navigating or connecting to localhost:\d+ \(connection refused\)/ },
    { name: 'assertions', baseURL: down, flagged: null },
  ]

  const outputs = await Promise.all(scenarios.map(async (s) => {
    const outputDir = await mkdtemp(join(tmpdir(), `kinora-incident-${s.name}-`))
    try {
      // Every test fails on purpose, so Playwright exits non-zero.
      const { stdout, stderr } = await run(process.execPath, [PLAYWRIGHT_CLI, 'test', '-c', CONFIG], {
        env: {
          ...process.env,
          KINORA_URL: SERVER_URL,
          KINORA_TOKEN: token,
          INCIDENT_SCENARIO: s.name,
          INCIDENT_BASE_URL: s.baseURL,
          INCIDENT_PROJECT_SLUG: `incident-${s.name}-${stamp}`,
          INCIDENT_OUTPUT_DIR: outputDir,
        },
      }).catch((error: { stdout: string, stderr: string }) => error)
      return `${stdout}${stderr}`
    }
    finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  }))

  for (const [i, s] of scenarios.entries()) {
    const output = outputs[i]
    expect(output, s.name).toContain('[kinora] uploaded 3 tests')
    if (s.flagged)
      expect(output, s.name).toMatch(new RegExp(`environment incident, not counted: 3 of 3 tests failed, 3 of them ${s.flagged.source}`))
    else
      expect(output, s.name).not.toContain('environment incident')
  }

  // The flag reaches the run page, with its reason and the rule that decided.
  await page.goto(`/projects/incident-refused-${stamp}`)
  await page.getByRole('row').nth(1).click()
  const banner = page.getByRole('status').filter({ hasText: 'Environment incident · not counted' })
  await expect(banner).toContainText('3 of 3 tests failed, 3 of them navigating or connecting to localhost:')
  await expect(banner).toContainText('Detected: most failures could not reach the app')
})
