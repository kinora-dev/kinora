export interface LocatorPick {
  selector: string
  locator: string
}

export function quoteLocatorValue(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, `\\'`)}'`
}

export function cssEscape(value: string, escape = globalThis.CSS?.escape): string {
  return escape?.(value) ?? value.replace(/[^\w-]/g, match => `\\${match}`)
}

export function attrSelector(name: string, value: string): string {
  return `[${name}=${JSON.stringify(value)}]`
}

export function uniqueSelector(element: Element, testIdName = 'data-testid'): string {
  const id = element.getAttribute('id')
  if (id)
    return `#${cssEscape(id)}`

  const testId = element.getAttribute(testIdName)
  if (testId)
    return attrSelector(testIdName, testId)

  for (const name of ['name', 'aria-label', 'placeholder', 'alt', 'title']) {
    const value = element.getAttribute(name)
    if (value)
      return `${element.tagName.toLowerCase()}${attrSelector(name, value)}`
  }

  const parts: string[] = []
  let current: Element | null = element
  while (current && current.nodeType === 1 && current.tagName.toLowerCase() !== 'html') {
    const currentElement: Element = current
    const parent: Element | null = currentElement.parentElement
    let part = currentElement.tagName.toLowerCase()
    if (parent) {
      const siblings = [...parent.children].filter(child => child.tagName === currentElement.tagName)
      if (siblings.length > 1)
        part += `:nth-of-type(${siblings.indexOf(currentElement) + 1})`
    }
    parts.unshift(part)
    if (part === 'body')
      break
    current = parent
  }
  return parts.join(' > ')
}

export function locatorForElement(element: Element, testIdName = 'data-testid'): LocatorPick {
  const selector = uniqueSelector(element, testIdName)
  const testId = element.getAttribute(testIdName)
  const placeholder = element.getAttribute('placeholder')
  const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim()
  const tag = element.tagName.toLowerCase()
  const role = tag === 'button' ? 'button' : element.getAttribute('role')
  const locator = testId
    ? `getByTestId(${quoteLocatorValue(testId)})`
    : placeholder
      ? `getByPlaceholder(${quoteLocatorValue(placeholder)})`
      : role && text
        ? `getByRole(${quoteLocatorValue(role)}, { name: ${quoteLocatorValue(text)} })`
        : text && text.length <= 80
          ? `getByText(${quoteLocatorValue(text)})`
          : `locator(${quoteLocatorValue(selector)})`
  return { selector, locator }
}

// Prefixes a pick made inside nested iframes with the frames leading to it, outermost first.
export function locatorInFrames(pick: LocatorPick, frameSelectors: string[]): LocatorPick {
  return {
    selector: [...frameSelectors.map(frame => `${frame} >> internal:control=enter-frame`), pick.selector].join(' >> '),
    locator: [...frameSelectors.map(frame => `locator(${quoteLocatorValue(frame)}).contentFrame()`), pick.locator].join('.'),
  }
}
