import { describe, expect, it } from 'vitest'
import { parseAttachmentKinds } from '../src/args'

describe('parseAttachmentKinds', () => {
  it('keeps the default when the flag is absent', () => {
    expect(parseAttachmentKinds(undefined)).toBeUndefined()
  })

  it('parses a comma list and tolerates spacing', () => {
    expect(parseAttachmentKinds('trace,video')).toEqual(['trace', 'video'])
    expect(parseAttachmentKinds(' trace , screenshot ')).toEqual(['trace', 'screenshot'])
  })

  it('rejects an unknown kind, naming it and the allowed values', () => {
    expect(() => parseAttachmentKinds('video,bogus')).toThrow(/bogus/)
    expect(() => parseAttachmentKinds('video,bogus')).toThrow(/trace, video, screenshot, snapshot/)
  })

  it('reads an empty value as uploading nothing', () => {
    expect(parseAttachmentKinds('')).toEqual([])
  })
})
