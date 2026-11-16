import { describe, expect, it } from 'vitest'
import { gitMetaSchema, runSummarySchema } from './kinora'

describe('runSummarySchema', () => {
  it('defaults countsByTag to an empty object', () => {
    const r = runSummarySchema.parse({
      runId: 'r',
      projectId: 'p',
      startedAt: '2026-01-01T00:00:00Z',
      duration: 0,
      counts: { total: 0, expected: 0, unexpected: 0, flaky: 0, skipped: 0 },
      reportPath: 'x',
    })
    expect(r.countsByTag).toEqual({})
  })
})

describe('gitMetaSchema repoUrl', () => {
  it('keeps an https url', () => {
    expect(gitMetaSchema.parse({ repoUrl: 'https://github.com/org/repo' }).repoUrl).toBe('https://github.com/org/repo')
  })

  it('drops a javascript: url instead of failing the run', () => {
    const r = gitMetaSchema.parse({ repoUrl: 'javascript:alert(1)', sha: 'abc' })
    expect(r.repoUrl).toBeUndefined()
    expect(r.sha).toBe('abc')
  })

  it('drops http and non-url strings', () => {
    expect(gitMetaSchema.parse({ repoUrl: 'http://github.com/org/repo' }).repoUrl).toBeUndefined()
    expect(gitMetaSchema.parse({ repoUrl: 'not a url' }).repoUrl).toBeUndefined()
  })
})
