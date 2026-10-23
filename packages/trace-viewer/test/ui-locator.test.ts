import { describe, expect, it } from 'vitest'
import { attrSelector, locatorForElement, locatorInFrames, quoteLocatorValue, uniqueSelector } from '../src/ui/lib/locator'

class FakeElement {
  nodeType = 1
  parentElement: FakeElement | null = null
  children: FakeElement[] = []
  textContent = ''

  constructor(public tagName: string, private attrs: Record<string, string> = {}) {}

  append(child: FakeElement): FakeElement {
    child.parentElement = this
    this.children.push(child)
    return child
  }

  getAttribute(name: string): string | null {
    return this.attrs[name] ?? null
  }
}

function el(tag: string, attrs: Record<string, string> = {}, text = ''): Element {
  const element = new FakeElement(tag.toUpperCase(), attrs)
  element.textContent = text
  return element as unknown as Element
}

describe('quoteLocatorValue', () => {
  it('quotes strings for Playwright locator snippets', () => {
    expect(quoteLocatorValue(`button's label`)).toBe(`'button\\'s label'`)
    expect(quoteLocatorValue(String.raw`C:\tmp\file`)).toBe(String.raw`'C:\\tmp\\file'`)
  })
})

describe('attrSelector', () => {
  it('uses JSON quoting for css attribute values', () => {
    expect(attrSelector('aria-label', 'Pay "now"')).toBe('[aria-label="Pay \\"now\\""]')
  })
})

describe('uniqueSelector', () => {
  it('prefers id selectors', () => {
    expect(uniqueSelector(el('button', { id: 'complete' }))).toBe('#complete')
  })

  it('uses the configured test id attribute', () => {
    expect(uniqueSelector(el('button', { 'data-qa': 'checkout' }), 'data-qa')).toBe('[data-qa="checkout"]')
  })

  it('falls back to stable semantic attributes', () => {
    expect(uniqueSelector(el('input', { placeholder: 'Customer email' }))).toBe('input[placeholder="Customer email"]')
  })

  it('builds a structural selector with nth-of-type when needed', () => {
    const body = new FakeElement('BODY')
    const section = body.append(new FakeElement('SECTION'))
    section.append(new FakeElement('BUTTON'))
    const second = section.append(new FakeElement('BUTTON'))

    expect(uniqueSelector(second as unknown as Element)).toBe('body > section > button:nth-of-type(2)')
  })
})

describe('locatorForElement', () => {
  it('uses getByTestId for test ids', () => {
    expect(locatorForElement(el('div', { 'data-testid': 'submit' })).locator).toBe(`getByTestId('submit')`)
  })

  it('uses getByPlaceholder for form controls', () => {
    expect(locatorForElement(el('input', { placeholder: 'Customer email' })).locator).toBe(`getByPlaceholder('Customer email')`)
  })

  it('uses getByRole for buttons with visible text', () => {
    expect(locatorForElement(el('button', {}, 'Complete checkout')).locator).toBe(`getByRole('button', { name: 'Complete checkout' })`)
  })

  it('uses getByText for short non-button text', () => {
    expect(locatorForElement(el('span', {}, 'Order complete')).locator).toBe(`getByText('Order complete')`)
  })

  it('falls back to locator(css) for long text', () => {
    const text = 'A'.repeat(81)
    expect(locatorForElement(el('div', { id: 'notice' }, text)).locator).toBe(`locator('#notice')`)
  })
})

describe('locatorInFrames', () => {
  it('keeps a top-frame pick as is', () => {
    const pick = { selector: '#pay', locator: `getByRole('button', { name: 'Pay' })` }
    expect(locatorInFrames(pick, [])).toEqual(pick)
  })

  it('enters each frame from the outermost one', () => {
    expect(locatorInFrames({ selector: '#cardholder', locator: `locator('#cardholder')` }, ['iframe[title="Payment frame"]', '#inner'])).toEqual({
      selector: 'iframe[title="Payment frame"] >> internal:control=enter-frame >> #inner >> internal:control=enter-frame >> #cardholder',
      locator: `locator('iframe[title="Payment frame"]').contentFrame().locator('#inner').contentFrame().locator('#cardholder')`,
    })
  })
})
