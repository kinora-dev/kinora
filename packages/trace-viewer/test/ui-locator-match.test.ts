import { describe, expect, it } from 'vitest'
import { matchStatus, selectorForFrame } from '../src/ui/lib/locatorMatch'

describe('selectorForFrame', () => {
  const frame = 'iframe[title="Pay"] >> internal:control=enter-frame >> '

  it('gives the top frame the whole selector', () => {
    expect(selectorForFrame('internal:role=button', '')).toBe('internal:role=button')
  })

  it('gives a nested frame what follows its frame selector', () => {
    expect(selectorForFrame(`${frame}internal:role=textbox`, frame)).toBe('internal:role=textbox')
  })

  it('leaves out frames the selector does not enter', () => {
    expect(selectorForFrame('internal:role=button', frame)).toBeUndefined()
    expect(selectorForFrame(frame, frame)).toBeUndefined()
  })
})

describe('matchStatus', () => {
  it('explains what Playwright would do with the count', () => {
    expect(matchStatus(1)).toEqual({ tone: 'pass', label: '1 match' })
    expect(matchStatus(0)).toMatchObject({ tone: 'fail', label: 'No match', hint: expect.stringContaining('times out') })
    expect(matchStatus(3)).toMatchObject({ tone: 'flaky', label: '3 matches', hint: expect.stringContaining('strict mode') })
    expect(matchStatus('invalid')).toEqual({ tone: 'fail', label: 'Invalid locator' })
  })
})
