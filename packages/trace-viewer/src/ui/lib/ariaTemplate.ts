export interface TemplateError {
  line: number
  column: number
  message: string
}

export interface ParsedTemplate {
  // `aria-template=<json>`, the selector the injected script matches against the DOM.
  selector?: string
  errors: TemplateError[]
}

// Loaded on first use: the YAML parser only matters once someone edits an ARIA snapshot.
export async function parseAriaTemplate(text: string): Promise<ParsedTemplate> {
  const [yaml, { parseAriaSnapshot }] = await Promise.all([import('yaml'), import('@isomorphic/ariaSnapshot')])
  const { fragment, errors } = parseAriaSnapshot(yaml, text, { prettyErrors: false })
  if (errors.length) {
    // Positions are 1-based; like upstream, an error points at the end of its range.
    return { errors: errors.map(error => ({ line: error.range[1].line, column: error.range[1].col, message: error.message })) }
  }
  return { selector: `aria-template=${JSON.stringify(fragment)}`, errors: [] }
}
