import { describe, expect, it } from 'vitest'
import { attachmentKind, DEFAULT_UPLOAD_ATTACHMENTS, isUploadableAttachment } from './ingest-client'

const trace = { name: 'trace', contentType: 'application/zip', path: '/r/trace.zip' }
const video = { name: 'video', contentType: 'video/webm', path: '/r/video.webm' }
const shot = { name: 'screenshot', contentType: 'image/png', path: '/r/s.png' }
const diff = { name: 'button-diff.png', contentType: 'image/png', path: '/r/button-diff.png' }

describe('attachmentKind', () => {
  it('classifies the kinds kinora can host', () => {
    expect(attachmentKind(trace)).toBe('trace')
    expect(attachmentKind(video)).toBe('video')
    expect(attachmentKind(shot)).toBe('screenshot')
    expect(attachmentKind(diff)).toBe('snapshot')
  })

  it('treats a zip path as a trace whatever its name', () => {
    expect(attachmentKind({ name: 'bundle', contentType: 'application/octet-stream', path: '/r/x.zip' })).toBe('trace')
  })

  it('returns null without a path (body-only or CI-local metadata)', () => {
    expect(attachmentKind({ name: 'video', contentType: 'video/webm' })).toBeNull()
  })

  it('returns null for kinds with nowhere to render them', () => {
    expect(attachmentKind({ name: 'stdout', contentType: 'text/plain', path: '/r/out.txt' })).toBeNull()
  })
})

describe('isUploadableAttachment', () => {
  it('uploads traces and failed-snapshot images by default', () => {
    expect(isUploadableAttachment(trace, DEFAULT_UPLOAD_ATTACHMENTS)).toBe(true)
    expect(isUploadableAttachment(diff, DEFAULT_UPLOAD_ATTACHMENTS)).toBe(true)
    expect(isUploadableAttachment(video, DEFAULT_UPLOAD_ATTACHMENTS)).toBe(false)
    expect(isUploadableAttachment(shot, DEFAULT_UPLOAD_ATTACHMENTS)).toBe(false)
  })

  it('can opt out of snapshot images', () => {
    expect(isUploadableAttachment(diff, ['trace'])).toBe(false)
  })

  it('covers snapshot images when every screenshot is asked for', () => {
    expect(isUploadableAttachment(diff, ['screenshot'])).toBe(true)
  })

  it('uploads media once opted in', () => {
    const kinds = ['trace', 'video', 'screenshot'] as const
    expect(isUploadableAttachment(video, kinds)).toBe(true)
    expect(isUploadableAttachment(shot, kinds)).toBe(true)
  })

  it('can upload media without traces', () => {
    expect(isUploadableAttachment(trace, ['video'])).toBe(false)
    expect(isUploadableAttachment(video, ['video'])).toBe(true)
  })
})
