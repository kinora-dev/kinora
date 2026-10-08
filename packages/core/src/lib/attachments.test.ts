import { describe, expect, it } from 'vitest'
import { effectiveAttachments, splitScreenshotComparisons } from './attachments'

const trace = { name: 'trace', contentType: 'application/zip', path: '/r/trace.zip' }
const shot = { name: 'screenshot', contentType: 'image/png', path: '/r/s.png' }

describe('effectiveAttachments', () => {
  // on-first-retry + retries: trace on attempt 1, traceless final attempt 2.
  it('surfaces a trace from an earlier attempt when the final attempt has none', () => {
    const results = [
      { attachments: [] },
      { attachments: [trace] },
      { attachments: [shot] },
    ]
    const got = effectiveAttachments(results)
    expect(got).toContain(shot)
    expect(got).toContain(trace)
  })

  it('keeps the final attempt as-is when it already has the trace', () => {
    const results = [{ attachments: [] }, { attachments: [shot, trace] }]
    expect(effectiveAttachments(results)).toEqual([shot, trace])
  })

  it('returns the final attempt untouched when no attempt has a trace', () => {
    const results = [{ attachments: [shot] }, { attachments: [shot] }]
    expect(effectiveAttachments(results)).toEqual([shot])
  })

  it('handles no results', () => {
    expect(effectiveAttachments([])).toEqual([])
  })
})

describe('splitScreenshotComparisons', () => {
  const png = (name: string) => ({ name, contentType: 'image/png' })

  it('groups the images of a failed screenshot assertion by snapshot name', () => {
    const expected = png('button-primary-expected.png')
    const actual = png('button-primary-actual.png')
    const diff = png('button-primary-diff.png')
    const { comparisons, rest } = splitScreenshotComparisons([trace, expected, actual, diff, shot])
    expect(comparisons).toEqual([{ name: 'button-primary.png', expected, actual, diff }])
    expect(rest).toEqual([trace, shot])
  })

  it('keeps comparisons apart, in order, including a missing baseline', () => {
    const { comparisons } = splitScreenshotComparisons([
      png('a-expected.png'),
      png('a-actual.png'),
      png('a-diff.png'),
      png('new-actual.png'),
      png('b-previous.png'),
      png('b-actual.png'),
    ])
    expect(comparisons.map(c => [c.name, Object.keys(c).filter(k => k !== 'name')])).toEqual([
      ['a.png', ['expected', 'actual', 'diff']],
      ['new.png', ['actual']],
      ['b.png', ['previous', 'actual']],
    ])
  })

  it('starts a new comparison when a snapshot name repeats', () => {
    const { comparisons } = splitScreenshotComparisons([png('a-actual.png'), png('a-diff.png'), png('a-actual.png')])
    expect(comparisons).toHaveLength(2)
    expect(comparisons[1].diff).toBeUndefined()
  })

  it('leaves non-images and incomplete groups alone', () => {
    const lone = png('orphan-expected.png')
    const text = { name: 'log-actual.txt', contentType: 'text/plain' }
    const { comparisons, rest } = splitScreenshotComparisons([lone, text, shot])
    expect(comparisons).toEqual([])
    expect(rest).toEqual([lone, text, shot])
  })
})
