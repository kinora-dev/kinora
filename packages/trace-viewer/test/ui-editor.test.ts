import { describe, expect, it } from 'vitest'
import { vscodeUrl } from '../src/ui/lib/editor'

describe('vscodeUrl', () => {
  it('builds a vscode://file link for a POSIX path', () => {
    expect(vscodeUrl('/Users/alex/app/tests/checkout.spec.ts', 12, 5)).toBe('vscode://file/Users/alex/app/tests/checkout.spec.ts:12:5')
  })

  it('keeps the drive letter of a Windows path', () => {
    expect(vscodeUrl('C:\\app\\tests\\checkout.spec.ts', 3)).toBe('vscode://file/C:/app/tests/checkout.spec.ts:3:1')
  })

  it('encodes spaces', () => {
    expect(vscodeUrl('/Users/alex/My App/a.spec.ts', 1)).toBe('vscode://file/Users/alex/My%20App/a.spec.ts:1:1')
  })
})
