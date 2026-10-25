const ANSI_RE = new RegExp(`${String.fromCharCode(0x1B)}\\[[0-9;]*m`, 'g')

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}

export interface StyledSegment {
  text: string
  style?: Record<string, string>
}

// The eight ANSI colours mapped onto the theme, so terminal output follows light and dark mode.
const ANSI_COLORS = ['var(--foreground)', 'var(--fail)', 'var(--pass)', 'var(--flaky)', 'var(--info)', 'var(--code-keyword)', 'var(--code-type)', 'var(--muted-foreground)']

const SGR_STYLES: Record<number, Record<string, string>> = {
  1: { fontWeight: 'bold' },
  2: { opacity: '0.8' },
  3: { fontStyle: 'italic' },
  4: { textDecoration: 'underline' },
  9: { textDecoration: 'line-through' },
}

const SGR_RESETS: Record<number, string[]> = {
  22: ['fontWeight', 'fontStyle', 'opacity'],
  23: ['fontWeight', 'fontStyle', 'opacity'],
  24: ['textDecoration'],
}

// SGR codes to styled text, after upstream's ansi2html but as data rather than HTML.
export function ansiSegments(text: string): StyledSegment[] {
  const segments: StyledSegment[] = []
  let style: Record<string, string> = {}
  let color: string | undefined
  let background: string | undefined
  // SGR 7: matchers highlight the differing characters of a diff with inverse video.
  let reverse = false
  const pattern = new RegExp(`${String.fromCharCode(0x1B)}\\[([\\d;]*)m|([^${String.fromCharCode(0x1B)}]+)`, 'g')
  for (const [, codes, chunk] of text.matchAll(pattern)) {
    if (chunk !== undefined) {
      const colors = reverse
        ? { color: 'var(--background)', backgroundColor: color ?? 'var(--foreground)' }
        : { ...(color && { color }), ...(background && { backgroundColor: background }) }
      const segmentStyle = { ...style, ...colors }
      segments.push(Object.keys(segmentStyle).length ? { text: chunk, style: segmentStyle } : { text: chunk })
      continue
    }
    for (const code of (codes || '0').split(';').map(Number)) {
      if (code === 0) {
        style = {}
        color = background = undefined
        reverse = false
      }
      else if (code === 7 || code === 27) {
        reverse = code === 7
      }
      else if (SGR_STYLES[code]) {
        style = { ...style, ...SGR_STYLES[code] }
      }
      else if (SGR_RESETS[code]) {
        style = Object.fromEntries(Object.entries(style).filter(([key]) => !SGR_RESETS[code].includes(key)))
      }
      else if ((code >= 30 && code <= 37) || (code >= 90 && code <= 97)) {
        color = ANSI_COLORS[code % 10]
      }
      else if (code === 39) {
        color = undefined
      }
      else if ((code >= 40 && code <= 47) || (code >= 100 && code <= 107)) {
        background = `color-mix(in oklch, ${ANSI_COLORS[code % 10]} 25%, transparent)`
      }
      else if (code === 49) {
        background = undefined
      }
    }
  }
  return segments
}
