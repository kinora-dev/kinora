import fs from 'node:fs'
import path from 'node:path'
import { zipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import { extractErrorContext, stripInstructions } from './error-context'

// A real failing-run trace (same fixture the viewer e2e uses) with an error-context attachment.
const FIXTURE = path.resolve(__dirname, '../../trace-viewer/public/fixtures/error-trace.zip')

describe('extractErrorContext', () => {
  it('pulls the error-context markdown out of a real trace.zip', () => {
    const md = extractErrorContext(fs.readFileSync(FIXTURE))
    expect(md).toBeTruthy()
    // Factual sections survive; the blob's own LLM instructions are stripped.
    expect(md).toContain('# Test info')
    expect(md).toContain('# Error details')
    expect(md).not.toContain('# Instructions')
  })

  it('reads the sha1-addressed resource of pre-v9 traces', () => {
    const after = { type: 'after', attachments: [{ name: 'error-context', contentType: 'text/markdown', sha1: 'abc' }] }
    const zip = zipSync({
      'test.trace': new TextEncoder().encode(`${JSON.stringify(after)}\n`),
      'resources/abc': new TextEncoder().encode('# Instructions\n- x\n\n# Test info\n- Name: t\n'),
    })
    expect(extractErrorContext(zip)).toBe('# Test info\n- Name: t')
  })

  it('returns null when the trace has no error-context', () => {
    const zip = zipSync({ 'test.trace': new TextEncoder().encode('{"type":"context-options"}\n') })
    expect(extractErrorContext(zip)).toBeNull()
  })

  it('returns null on garbage input', () => {
    expect(extractErrorContext(new TextEncoder().encode('not a zip'))).toBeNull()
  })
})

describe('stripInstructions', () => {
  it('keeps everything from "# Test info" on', () => {
    expect(stripInstructions('# Instructions\n- be concise\n\n# Test info\n- Name: t\n')).toBe('# Test info\n- Name: t')
  })

  it('leaves markdown without an Instructions header untouched', () => {
    expect(stripInstructions('# Test info\n- Name: t')).toBe('# Test info\n- Name: t')
  })
})
