import { describe, expect, it } from 'vitest'
import { prLegLabel, resolvePrReportOptions } from './pr-report'

describe('resolvePrReportOptions', () => {
  it('turns nothing on by default', () => {
    expect(resolvePrReportOptions(undefined, false)).toEqual({})
  })

  it('posts the comment always unless told on-failure', () => {
    expect(resolvePrReportOptions(true, undefined)).toEqual({ comment: { label: undefined, policy: 'always' } })
    expect(resolvePrReportOptions({ policy: 'on-failure' }, undefined).comment?.policy).toBe('on-failure')
  })

  it('gives the status the comment label unless it has its own', () => {
    expect(resolvePrReportOptions({ label: 'firefox' }, true).status).toEqual({ label: 'firefox' })
    expect(resolvePrReportOptions({ label: 'firefox' }, { label: 'webkit' }).status).toEqual({ label: 'webkit' })
  })

  it('tells matrix legs apart by the comment label, else the status one', () => {
    expect(prLegLabel(resolvePrReportOptions({ label: 'firefox' }, { label: 'webkit' }))).toBe('firefox')
    expect(prLegLabel(resolvePrReportOptions(undefined, { label: 'webkit' }))).toBe('webkit')
    expect(prLegLabel({})).toBeUndefined()
  })
})
