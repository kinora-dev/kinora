import type { FullConfig } from '@playwright/test'
import type { AddressInfo } from 'node:net'
import type { BaseUrlTarget, Probe } from '../src/check-base-url'
import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import globalSetup, { baseUrlTargets, checkBaseUrl, checkBaseUrls } from '../src/check-base-url'

type Project = FullConfig['projects'][number]
function project(name: string, use: Partial<Project['use']> = {}, dependencies: string[] = []) {
  return ({ name, dependencies, use }) as unknown as Project
}
const config = (projects: Project[], filteredProjects?: Project[]) => ({ projects, filteredProjects }) as unknown as FullConfig

const target = (url = 'https://staging.example.test'): BaseUrlTarget => ({ url, projects: [], ignoreHTTPSErrors: false, remoteBrowser: false })
const answers = (...outcomes: Awaited<ReturnType<Probe>>[]): Probe => async () => outcomes.shift()!
const fast = { delayMs: 0, env: {} }

// A local app answering `status`, and a port nothing listens on.
let app: ReturnType<typeof createServer>
let appUrl = ''
let downUrl = ''
let status = 404
beforeAll(async () => {
  app = createServer((_req, res) => res.writeHead(status).end())
  await new Promise<void>(resolve => app.listen(0, '127.0.0.1', resolve))
  appUrl = `http://127.0.0.1:${(app.address() as AddressInfo).port}`
  const closed = createServer()
  await new Promise<void>(resolve => closed.listen(0, '127.0.0.1', resolve))
  downUrl = `http://127.0.0.1:${(closed.address() as AddressInfo).port}`
  await new Promise(resolve => closed.close(resolve))
})
afterAll(() => new Promise(resolve => app.close(resolve)))

describe('baseUrlTargets', () => {
  it('lists each http(s) baseURL once, with the projects that use it', () => {
    const targets = baseUrlTargets(config([
      project('chromium', { baseURL: 'https://staging.example.test' }),
      project('firefox', { baseURL: 'https://staging.example.test', ignoreHTTPSErrors: true }),
      project('unit'),
      project('file', { baseURL: 'file:///tmp/app' }),
    ]), [], {})
    expect(targets).toEqual([{ url: 'https://staging.example.test', projects: ['chromium', 'firefox'], ignoreHTTPSErrors: false, proxy: undefined, remoteBrowser: false }])
  })

  it('checks only the projects the run selects, and their dependencies', () => {
    const projects = [
      project('setup', { baseURL: 'https://auth.example.test' }),
      project('chromium', { baseURL: 'https://staging.example.test' }, ['setup']),
      project('admin', { baseURL: 'https://admin.example.test' }),
    ]
    const urls = (argv: string[], filtered?: Project[]) => baseUrlTargets(config(projects, filtered), argv, {}).map(t => t.url)

    expect(urls([], [projects[1]])).toEqual(['https://auth.example.test', 'https://staging.example.test'])
    expect(urls(['--project', 'CHROM*'])).toEqual(['https://auth.example.test', 'https://staging.example.test'])
    expect(urls(['--project=chromium', '--no-deps'])).toEqual(['https://staging.example.test'])
    expect(urls([])).toHaveLength(3)
  })

  it('notes a browser that runs on another machine', () => {
    const [remote] = baseUrlTargets(config([project('grid', { baseURL: 'https://staging.example.test', connectOptions: { wsEndpoint: 'ws://grid:3000' } })]), [], {})
    expect(remote.remoteBrowser).toBe(true)
    const [fromEnv] = baseUrlTargets(config([project('grid', { baseURL: 'https://staging.example.test' })]), [], { PW_TEST_CONNECT_WS_ENDPOINT: 'ws://grid:3000' })
    expect(fromEnv.remoteBrowser).toBe(true)
  })
})

describe('checkBaseUrl', () => {
  it('passes on any answer from the app, a 404 or a 500 included', async () => {
    expect(await checkBaseUrl(target(), { ...fast, probe: answers({ status: 404 }) })).toBeNull()
    expect(await checkBaseUrl(target(), { ...fast, probe: answers({ status: 500 }) })).toBeNull()
  })

  it('takes a gateway error for the app being down, and retries before giving up', async () => {
    expect(await checkBaseUrl(target(), { ...fast, probe: answers({ status: 503 }, { error: 'x' }, { status: 502 }) }))
      .toBe('502 bad gateway (3 attempts)')
    expect(await checkBaseUrl(target(), { ...fast, probe: answers({ status: 503 }, { status: 200 }) })).toBeNull()
  })

  it('reaches a real app through Playwright\'s request context', async () => {
    status = 404
    expect(await checkBaseUrl(target(appUrl), { ...fast, attempts: 1 })).toBeNull()
    status = 503
    expect(await checkBaseUrl(target(appUrl), { ...fast, attempts: 1 })).toBe('503 service unavailable (1 attempt)')
    expect(await checkBaseUrl(target(downUrl), { ...fast, attempts: 1 })).toMatch(/ECONNREFUSED/)
  })
})

describe('checkBaseUrls', () => {
  it('throws one message naming every base URL down', async () => {
    const run = checkBaseUrls(config([
      project('chromium', { baseURL: 'https://staging.example.test' }),
      project('grid', { baseURL: 'https://admin.example.test', connectOptions: { wsEndpoint: 'ws://grid:3000' } }),
    ]), { ...fast, attempts: 1, argv: [], probe: answers({ error: 'connect ECONNREFUSED' }, { status: 504 }) })
    await expect(run).rejects.toThrow([
      '[kinora] The app under test did not answer, so no test ran:',
      '  https://staging.example.test (chromium): connect ECONNREFUSED (1 attempt)',
      '  https://admin.example.test (grid): 504 gateway timeout (1 attempt)',
      '    The check ran from this machine, but the browser runs on another one and may reach admin.example.test from its own network.',
      'Bring the environment back and run again, or set KINORA_CHECK_BASE_URL=false to run the tests anyway.',
    ].join('\n'))
  })

  it('is skipped with KINORA_CHECK_BASE_URL=false', async () => {
    const run = checkBaseUrls(config([project('chromium', { baseURL: downUrl })]), { attempts: 1, argv: [], env: { KINORA_CHECK_BASE_URL: 'false' } })
    await expect(run).resolves.toBeUndefined()
  })

  it('is the default export, as a Playwright global setup', async () => {
    status = 200
    await expect(globalSetup(config([project('chromium', { baseURL: appUrl })]))).resolves.toBeUndefined()
  })
})

// The check as Playwright runs it: listed in `globalSetup`, it stops the run before any test.
describe('in a real Playwright run', () => {
  const PLAYWRIGHT_CLI = createRequire(import.meta.url).resolve('@playwright/test/cli')
  const CONFIG = fileURLToPath(new URL('./fixtures/check-base-url/playwright.config.ts', import.meta.url))

  async function playwright(baseUrl: string) {
    const outputDir = await mkdtemp(join(tmpdir(), 'kinora-check-'))
    try {
      const env = { ...process.env, CHECK_BASE_URL: baseUrl, CHECK_OUTPUT_DIR: outputDir, KINORA_CHECK_BASE_URL: '' }
      return await promisify(execFile)(process.execPath, [PLAYWRIGHT_CLI, 'test', '-c', CONFIG], { env })
        .then(r => ({ ...r, failed: false }), (error: { stdout: string, stderr: string }) => ({ ...error, failed: true }))
    }
    finally {
      await rm(outputDir, { recursive: true, force: true })
    }
  }

  it('runs the tests when the app answers', async () => {
    status = 404
    const res = await playwright(appUrl)
    expect(res.failed).toBe(false)
    expect(`${res.stdout}${res.stderr}`).toContain('TEST RAN')
  }, 60_000)

  it('stops before any test when the app is down', async () => {
    const res = await playwright(downUrl)
    expect(res.failed).toBe(true)
    expect(`${res.stdout}${res.stderr}`).toContain(`[kinora] The app under test did not answer, so no test ran:\n  ${downUrl}`)
    expect(`${res.stdout}${res.stderr}`).not.toContain('TEST RAN')
  }, 60_000)
})
