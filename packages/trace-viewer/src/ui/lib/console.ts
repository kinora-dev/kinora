import type { ConsoleMessageTraceEvent, EventTraceEvent, StdioTraceEvent } from '@trace/trace'
import type { StyledSegment } from './ansi'
import { ansiSegments } from './ansi'

export type ConsoleLevel = 'error' | 'warning' | 'log'

export interface ConsoleEntry {
  kind: 'console' | 'pageError' | 'stdout' | 'stderr'
  level: ConsoleLevel
  // Badge text: the console method, or where the line came from.
  label: string
  time: number
  // `page#N` for browser messages, `test` for runner stdio.
  source: string
  body: StyledSegment[]
  // Plain text, used to fold repeats.
  text: string
  stack?: string
  console?: ConsoleMessageTraceEvent
  repeat: number
}

interface ConsoleArg { preview: string, value: unknown }

function level(type: string): ConsoleLevel {
  if (type === 'error')
    return 'error'
  return type === 'warning' || type === 'warn' ? 'warning' : 'log'
}

const STYLE_PREFIXES = ['background', 'border', 'color', 'font', 'line', 'margin', 'padding', 'text']

// `%c` CSS, limited like upstream to properties that cannot break out of the line.
export function parseConsoleCss(css: string): Record<string, string> {
  const style: Record<string, string> = {}
  for (const declaration of css.split(';')) {
    const [key, ...rest] = declaration.split(':')
    const name = key?.trim()
    const value = rest.join(':').trim()
    if (name && value && STYLE_PREFIXES.some(p => name.startsWith(p)))
      style[name.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value
  }
  return style
}

const NON_STRING = { color: 'var(--code-number)' }

// Browser-like rendering of console arguments: %s/%d/%i/%f/%o/%O substitute, %c styles what follows.
export function formatConsoleArgs(args: ConsoleArg[]): StyledSegment[] {
  if (args.length === 1)
    return ansiSegments(args[0].preview)
  const format = typeof args[0].value === 'string' && args[0].value.includes('%') ? args[0].value : ''
  const tail = format ? args.slice(1) : args
  const segments: StyledSegment[] = []
  let style: Record<string, string> | undefined
  let argIndex = 0
  let index = 0
  const push = (text: string, extra?: Record<string, string>): void => {
    if (!text)
      return
    const merged = style || extra ? { ...style, ...extra } : undefined
    segments.push(merged ? { text, style: merged } : { text })
  }
  for (const match of format.matchAll(/%([%sdifoOc])/g)) {
    push(format.slice(index, match.index))
    index = match.index + 2
    const specifier = match[1]
    if (specifier === '%') {
      push('%')
    }
    else if (specifier === 'c') {
      const css = tail[argIndex++]
      style = css ? parseConsoleCss(css.preview) : undefined
      if (style && !Object.keys(style).length)
        style = undefined
    }
    else {
      const arg = tail[argIndex++]
      push(arg?.preview ?? '', typeof arg?.value === 'string' ? undefined : NON_STRING)
    }
  }
  push(format.slice(index))
  for (; argIndex < tail.length; argIndex++) {
    const arg = tail[argIndex]
    if (segments.length)
      push(' ')
    push(arg.preview, typeof arg.value === 'string' ? undefined : NON_STRING)
  }
  return segments
}

function stdioText(event: StdioTraceEvent): string {
  return (event.text ?? (event.base64 ? atob(event.base64) : '')).trimEnd()
}

export interface ConsoleSources {
  events: (EventTraceEvent | ConsoleMessageTraceEvent)[]
  stdio: StdioTraceEvent[]
  pageTitle: (pageId: string | undefined) => string
}

// Console messages, page errors and runner stdio in time order, repeats folded like upstream:
// the same line from the same source within a second becomes one entry with a count.
// Whether console output at `time` belongs to an action: up to the next action like upstream's
// badges, but never short of the action's own end (a step's next action is its first child).
// An unfinished action keeps everything after its start.
export function inActionConsoleScope(time: number, action: { startTime: number, endTime: number }, nextStart: number | undefined): boolean {
  if (time < action.startTime)
    return false
  if (nextStart === undefined || time < nextStart)
    return true
  return !action.endTime || time <= action.endTime
}

export function consoleEntries({ events, stdio, pageTitle }: ConsoleSources): ConsoleEntry[] {
  const items: Omit<ConsoleEntry, 'repeat'>[] = []
  for (const event of events) {
    if (event.type === 'console') {
      const args = (event.args ?? []) as ConsoleArg[]
      items.push({
        kind: 'console',
        level: level(event.messageType),
        label: event.messageType,
        time: event.time,
        source: pageTitle(event.pageId),
        body: args.length ? formatConsoleArgs(args) : ansiSegments(event.text),
        text: event.text,
        console: event,
      })
    }
    else if (event.method === 'pageError') {
      const { error, value } = (event.params?.error ?? {}) as { error?: { message: string, stack?: string }, value?: unknown }
      const message = error?.message ?? String(value)
      items.push({
        kind: 'pageError',
        level: 'error',
        label: 'page error',
        time: event.time,
        source: pageTitle(event.pageId),
        body: [{ text: message }],
        text: message,
        stack: error?.stack,
      })
    }
  }
  for (const event of stdio) {
    const text = stdioText(event)
    items.push({
      kind: event.type,
      level: event.type === 'stderr' ? 'error' : 'log',
      label: event.type,
      time: event.timestamp,
      source: 'test',
      body: ansiSegments(text),
      text,
    })
  }
  items.sort((a, b) => a.time - b.time)

  const entries: ConsoleEntry[] = []
  for (const item of items) {
    const last = entries.at(-1)
    const location = (e: { console?: ConsoleMessageTraceEvent }) => JSON.stringify(e.console?.location ?? null)
    if (last && last.kind === item.kind && last.text === item.text && last.level === item.level && last.source === item.source
      && location(last) === location(item) && item.time - last.time < 1000) {
      last.repeat++
    }
    else {
      entries.push({ ...item, repeat: 1 })
    }
  }
  return entries
}
