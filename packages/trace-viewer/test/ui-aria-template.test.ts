import { describe, expect, it } from 'vitest'
import { parseAriaTemplate } from '../src/ui/lib/ariaTemplate'

describe('parseAriaTemplate', () => {
  it('turns a valid template into an aria-template selector', async () => {
    const { selector, errors } = await parseAriaTemplate('- button "Complete checkout"')
    expect(errors).toEqual([])
    expect(selector).toMatch(/^aria-template=\{/)
    expect(JSON.parse(selector!.slice('aria-template='.length))).toMatchObject({ kind: 'role', role: 'button' })
  })

  it('reports syntax errors with their line', async () => {
    const { selector, errors } = await parseAriaTemplate('- heading "Checkout"\n- button "Pay\n')
    expect(selector).toBeUndefined()
    expect(errors.length).toBeGreaterThan(0)
    expect(errors[0].line).toBeGreaterThanOrEqual(2)
    expect(errors[0].message).toBeTruthy()
  })
})
