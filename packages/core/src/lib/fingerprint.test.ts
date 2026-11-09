import type { RunReport } from '../contracts/kinora'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../contracts/kinora'
import { buildFailureClusters, fingerprintError, normalizeErrorMessage } from './fingerprint'

describe('normalizeErrorMessage', () => {
  it('strips line:col and timeouts so variable noise collapses', () => {
    const a = normalizeErrorMessage('TimeoutError: locator.click: Timeout 15000ms exceeded at foo.ts:23:7')
    const b = normalizeErrorMessage('TimeoutError: locator.click: Timeout 30000ms exceeded at foo.ts:41:12')
    expect(a).toBe(b)
  })

  it('keeps bare numbers so distinct assertion values stay apart', () => {
    const a = normalizeErrorMessage('expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500')
    const b = normalizeErrorMessage('expect(received).toBe(expected)\n\nExpected: 200\nReceived: 404')
    expect(a).not.toBe(b)
  })

  it('strips ansi and stack frames', () => {
    const s = normalizeErrorMessage('[31mError: boom[0m\n    at Object.<anonymous> (/repo/a.ts:1:1)')
    expect(s).not.toContain('')
    expect(s).not.toContain('at Object')
  })

  it('keeps distinct assertions distinct', () => {
    const a = normalizeErrorMessage('expect(received).toBe(expected)')
    const b = normalizeErrorMessage('expect(locator).toBeVisible() failed')
    expect(a).not.toBe(b)
  })
})

describe('fingerprintError', () => {
  it('same signature, different numbers -> same fingerprint', () => {
    const a = fingerprintError({ message: 'Timeout 5000ms exceeded', stack: 'at a.ts:1:1' })
    const b = fingerprintError({ message: 'Timeout 9000ms exceeded', stack: 'at a.ts:9:9' })
    expect(a.fingerprint).toBe(b.fingerprint)
  })

  it('title is the first line', () => {
    const fp = fingerprintError({ message: 'Error: boom\n\nExpected: 1\nReceived: 2' })
    expect(fp.title).toBe('Error: boom')
  })

  it('adds the locator of a Playwright assertion to its title', () => {
    const msg = (locator: string) => `Error: expect(locator).toHaveText(expected) failed\n\nLocator:  ${locator}\nExpected: "a"\nReceived: "b"`
    const a = fingerprintError({ message: msg('getByRole(\'status\')') })
    const b = fingerprintError({ message: msg('getByTestId(\'total\')') })
    expect(a.title).toBe('Error: expect(locator).toHaveText(expected) failed · getByRole(\'status\')')
    expect(a.title).not.toBe(b.title)
  })

  it('falls back to stack when message empty', () => {
    const fp = fingerprintError({ message: '', stack: 'ReferenceError: x is not defined' })
    expect(fp.fingerprint).not.toBe(fingerprintError({ message: '' }).fingerprint)
  })
})

function report(runId: string, startedAt: string, tests: RunReport['tests']): RunReport {
  return {
    schemaVersion: SCHEMA_VERSION,
    runId,
    projectId: 'p',
    startedAt,
    duration: 0,
    counts: { total: tests.length, expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
    meta: {},
    tests,
  }
}

function failing(testKey: string, file: string, message: string): RunReport['tests'][number] {
  return {
    testKey,
    title: testKey,
    titlePath: [testKey],
    file,
    line: 1,
    column: 1,
    projectName: 'chromium',
    status: 'unexpected',
    ok: false,
    duration: 1,
    retries: 0,
    tags: [],
    annotations: [],
    errors: [{ message }],
    attachments: [],
  }
}

describe('buildFailureClusters', () => {
  it('groups shared errors and counts distinct tests + occurrences', () => {
    const clusters = buildFailureClusters([
      report('r1', '2026-01-01T00:00:00Z', [
        failing('t1', 'a.spec.ts', 'Timeout 5000ms exceeded'),
        failing('t2', 'b.spec.ts', 'Timeout 9000ms exceeded'),
      ]),
      report('r2', '2026-01-02T00:00:00Z', [
        failing('t1', 'a.spec.ts', 'Timeout 7000ms exceeded'),
        failing('t3', 'c.spec.ts', 'expect(received).toBe(expected)'),
      ]),
    ])

    expect(clusters).toHaveLength(2)
    const timeout = clusters[0]
    expect(timeout.tests).toBe(2) // t1, t2
    expect(timeout.count).toBe(3) // three occurrences
    expect(timeout.testKeys.sort()).toEqual(['t1', 't2'])
    expect(timeout.files.sort()).toEqual(['a.spec.ts', 'b.spec.ts'])
    expect(timeout.lastSeen).toBe('2026-01-02T00:00:00.000Z')
  })

  it('ignores passing tests and errorless failures', () => {
    const pass = { ...failing('t1', 'a.ts', 'x'), status: 'expected' as const, ok: true, errors: [] }
    const noErr = { ...failing('t2', 'b.ts', 'x'), errors: [] }
    expect(buildFailureClusters([report('r1', '2026-01-01T00:00:00Z', [pass, noErr])])).toHaveLength(0)
  })

  it('sorts widest blast radius first', () => {
    const clusters = buildFailureClusters([
      report('r1', '2026-01-01T00:00:00Z', [
        failing('t1', 'a.ts', 'rare error'),
        failing('t2', 'b.ts', 'common error'),
        failing('t3', 'c.ts', 'common error'),
      ]),
    ])
    expect(clusters[0].title).toBe('common error')
    expect(clusters[0].tests).toBe(2)
  })
})
