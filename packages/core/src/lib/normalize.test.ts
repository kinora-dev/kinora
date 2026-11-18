import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { ingestPlaywrightReport, runWorkers } from './normalize'

const raw: unknown = JSON.parse(
  readFileSync(new URL('../__fixtures__/sample-report.json', import.meta.url), 'utf8'),
)

describe('ingestPlaywrightReport', () => {
  const { summary, report } = ingestPlaywrightReport(raw, { projectId: 'web-app', runId: 'r1' })

  it('flattens nested suites into a flat test list', () => {
    expect(report.tests).toHaveLength(5)
  })

  it('carries the run counts from stats', () => {
    expect(report.counts).toEqual({ total: 5, expected: 2, unexpected: 1, flaky: 1, skipped: 1 })
  })

  it('strips attachment bodies but keeps metadata + hasBody flag', () => {
    const fail = report.tests.find(t => t.status === 'unexpected')
    const shot = fail?.attachments.find(a => a.name === 'screenshot')
    const trace = fail?.attachments.find(a => a.name === 'trace')
    expect(shot?.hasBody).toBe(true)
    expect(trace?.path).toBeTruthy()
    expect(trace?.hasBody).toBe(false)
    expect(JSON.stringify(report)).not.toContain('iVBORw0') // base64 gone
  })

  it('reads an axe scan attached to a test as JSON, trimmed to its violations', () => {
    const scan = {
      testEngine: { name: 'axe-core', version: '4.10.2' },
      passes: [{ id: 'region', nodes: [{ html: '<main>' }] }],
      violations: [{ id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name', nodes: [{ target: ['#save'], html: '<button id="save">é</button>' }] }],
    }
    // Playwright's JSON report carries an inline attachment body in base64.
    const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(scan))))
    const withScan = structuredClone(raw) as { suites: { specs: { title: string, tests: { results: { attachments: unknown[] }[] }[] }[], suites?: unknown[] }[] }
    const specs = (suites: typeof withScan.suites): typeof withScan.suites[number]['specs'] => suites.flatMap(x => [...x.specs, ...specs((x.suites ?? []) as typeof withScan.suites)])
    const login = specs(withScan.suites).find(x => x.title === 'login works')!
    login.tests[0].results.at(-1)!.attachments.push({ name: 'accessibility-scan-results', contentType: 'application/json', body: base64 })

    const t = ingestPlaywrightReport(withScan, { projectId: 'web-app', runId: 'r1' }).report.tests.find(x => x.title === 'login works')
    expect(t?.a11y).toEqual({
      status: 'warning',
      violations: [{ id: 'button-name', impact: 'critical', help: 'Buttons must have discernible text', helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/button-name', nodes: ['#save'], nodeCount: 1 }],
    })
    expect(report.tests.every(x => x.a11y === undefined)).toBe(true)
  })

  it('builds a stable testKey from file + title path + project', () => {
    const t = report.tests.find(x => x.title === 'login works')
    expect(t?.testKey).toContain('tests/auth.spec.ts')
    expect(t?.testKey).toContain('login works')
    expect(t?.testKey).toContain('chromium')
  })

  it('derives retries from the number of results', () => {
    const flaky = report.tests.find(t => t.status === 'flaky')
    expect(flaky?.retries).toBe(1)
  })

  it('precomputes per-tag counts on the summary', () => {
    expect(summary.countsByTag['@smoke']).toEqual({
      total: 1,
      expected: 1,
      unexpected: 0,
      flaky: 0,
      skipped: 0,
    })
  })

  it('sets reportPath by convention', () => {
    expect(summary.reportPath).toBe('reports/web-app/r1.json')
  })
})

describe('runWorkers', () => {
  it('prefers the workers the runner started over the configured count', () => {
    expect(runWorkers({ workers: 4, metadata: { actualWorkers: 2 } })).toBe(2)
    expect(runWorkers({ workers: 4, metadata: {} })).toBe(4)
    expect(runWorkers({ workers: 0 })).toBeUndefined()
    expect(runWorkers(undefined)).toBeUndefined()
  })

  it('reads them from a JSON report config', () => {
    const withWorkers = { ...(raw as object), config: { ...(raw as { config?: object }).config, workers: 3, metadata: { actualWorkers: 3 } } }
    expect(ingestPlaywrightReport(withWorkers, { projectId: 'web-app', runId: 'r1' }).report.meta.workers).toBe(3)
  })
})
