import { describe, expect, it } from 'vitest'
import { parseAttachmentKinds, parseBaseUrls } from '../src/args'

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

describe('parseBaseUrls', () => {
  it('takes the repeated flag first, else the comma-separated env', () => {
    expect(parseBaseUrls(['https://staging.example.test', 'http://localhost:3000'], 'https://ignored.test')).toEqual(['https://staging.example.test', 'http://localhost:3000'])
    expect(parseBaseUrls(undefined, ' https://staging.example.test , http://localhost:3000 ')).toEqual(['https://staging.example.test', 'http://localhost:3000'])
  })

  it('is absent when neither is set', () => {
    expect(parseBaseUrls(undefined, undefined)).toBeUndefined()
    expect(parseBaseUrls([], '')).toBeUndefined()
  })

  it('rejects anything but an http(s) URL', () => {
    expect(() => parseBaseUrls(['staging.example.test'], undefined)).toThrow(/invalid --base-url: staging\.example\.test/)
    expect(() => parseBaseUrls(['file:///tmp/app'], undefined)).toThrow(/file:\/\/\/tmp\/app/)
  })
})
