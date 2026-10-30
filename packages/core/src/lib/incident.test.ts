import type { NormTest } from '../contracts/kinora'
import { describe, expect, it } from 'vitest'
import { detectIncident } from './incident'

type T = Pick<NormTest, 'status' | 'errors'>

const failed = (...messages: string[]): T => ({ status: 'unexpected', errors: messages.map(message => ({ message })) })
const passed: T = { status: 'expected', errors: [] }
const skipped: T = { status: 'skipped', errors: [] }
const times = (n: number, t: T): T[] => Array.from({ length: n }).fill(t) as T[]

const refused = failed('Error: page.goto: net::ERR_CONNECTION_REFUSED at https://staging.example.test/login\nCall log:\n  - navigating to "https://staging.example.test/login", waiting until "load"')
const assertion = failed('Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole(\'heading\', { name: \'Welcome\' })\nExpected: visible')

describe('detectIncident', () => {
  it('flags a run whose failures could not reach the baseURL host', () => {
    const incident = detectIncident([...times(9, refused), passed], ['https://staging.example.test'])
    expect(incident).toEqual({
      rule: 'host-unreachable',
      reason: '9 of 10 tests failed, 9 of them navigating or connecting to staging.example.test (connection refused).',
      host: 'staging.example.test',
    })
  })

  it('falls back to the host most failures named without a baseURL', () => {
    expect(detectIncident(times(5, refused))?.host).toBe('staging.example.test')
  })

  it('ignores a third-party host going down', () => {
    const cdn = failed('Error: apiRequestContext.get: getaddrinfo ENOTFOUND cdn.vendor.test')
    expect(detectIncident(times(5, cdn), ['https://staging.example.test'])).toBeNull()
  })

  it('never flags failing assertions, however many tests they break', () => {
    expect(detectIncident(times(40, assertion), ['https://staging.example.test'])).toBeNull()
  })

  it('needs at least three failures and 80% of the executed tests failing', () => {
    expect(detectIncident(times(2, refused))).toBeNull()
    expect(detectIncident([...times(7, refused), ...times(3, passed)])).toBeNull()
    // Skipped tests are not executed, so they do not dilute the failure rate.
    expect(detectIncident([...times(4, refused), ...times(20, skipped)])).not.toBeNull()
  })

  it('needs 70% of the failures to share the cause', () => {
    expect(detectIncident([...times(6, refused), ...times(4, assertion)])).toBeNull()
    expect(detectIncident([...times(7, refused), ...times(3, assertion)])?.rule).toBe('host-unreachable')
  })

  it('matches a loopback socket error against a localhost baseURL on the same port', () => {
    const socket = failed('Error: apiRequestContext.post: connect ECONNREFUSED 127.0.0.1:3000')
    expect(detectIncident(times(4, socket), ['http://localhost:3000'])?.host).toBe('localhost:3000')
    expect(detectIncident(times(4, socket), ['http://localhost:4000'])).toBeNull()
  })

  it('counts a page.goto timeout on the app host', () => {
    const timeout = failed(
      'Test timeout of 30000ms exceeded.',
      'Error: page.goto: Test timeout of 30000ms exceeded.\nCall log:\n  - navigating to "https://staging.example.test/", waiting until "load"',
    )
    const incident = detectIncident(times(5, timeout), ['https://staging.example.test'])
    expect(incident?.reason).toContain('(timed out)')
  })

  it('flags the browser crashing', () => {
    const crash = failed('Error: page.click: Target crashed')
    expect(detectIncident(times(5, crash))).toEqual({
      rule: 'browser-crash',
      reason: '5 of 5 tests failed, 5 of them with the browser crashing or closing.',
    })
  })

  it('does not take a closed browser after a test timeout for a crash', () => {
    const timedOut = failed('Test timeout of 30000ms exceeded.', 'Error: locator.click: Target page, context or browser has been closed')
    expect(detectIncident(times(5, timedOut))).toBeNull()
  })

  it('reads through ANSI colors', () => {
    const colored = failed('\u001B[31mError: page.goto: net::ERR_NAME_NOT_RESOLVED at https://staging.example.test/\u001B[39m')
    expect(detectIncident(times(3, colored))?.reason).toContain('(name not resolved)')
  })
})
