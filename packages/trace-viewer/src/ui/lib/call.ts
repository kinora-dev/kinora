import type { ActionEntry } from '@isomorphic/trace/entries'
import { actionDuration, actionStatus, actionTitle } from './action'
import { stripAnsi } from './ansi'
import { formatMs } from './format'

export interface CallRow {
  key: string
  value: string
  tone?: 'default' | 'muted' | 'error'
}

export interface CallSummary {
  title: string
  subtitle: string
  status: string
  statusTone: 'default' | 'muted' | 'error'
  duration: string
  primary: CallRow[]
  params: CallRow[]
  result?: string
  error?: string
}

const PRIMARY_KEYS = ['selector', 'locator', 'url', 'value', 'text', 'expected', 'expression', 'timeout']

export function stringifyCallValue(value: unknown): string {
  if (typeof value === 'string')
    return value
  if (value === undefined)
    return 'undefined'
  try {
    return JSON.stringify(value, null, 2)
  }
  catch {
    return String(value)
  }
}

export function expectedTextValue(value: unknown): string | undefined {
  if (!Array.isArray(value))
    return undefined
  return value
    .map((item) => {
      if (typeof item === 'string')
        return item
      if (item && typeof item === 'object' && 'string' in item)
        return String((item as { string: unknown }).string)
      return undefined
    })
    .filter((item): item is string => !!item)
    .join('\n') || undefined
}

export function callSummary(action: ActionEntry): CallSummary {
  const status = actionStatus(action)
  const primary = primaryRows(action)
  const primaryKeys = new Set(primary.map(row => row.key))
  const params = Object.entries(action.params ?? {})
    .filter(([key]) => !primaryKeys.has(key) && key !== 'expectedText')
    .map(([key, value]) => ({ key, value: stringifyCallValue(value) }))

  return {
    title: action.title || actionTitle(action),
    subtitle: action.subtitle || `${action.class}.${action.method}`,
    status: status === 'error' ? 'error' : status === 'step' ? 'step' : 'ok',
    statusTone: status === 'error' ? 'error' : status === 'step' ? 'muted' : 'default',
    duration: formatMs(actionDuration(action)),
    primary,
    params,
    result: action.result === undefined ? undefined : stringifyCallValue(action.result),
    error: action.error?.message ? stripAnsi(action.error.message) : undefined,
  }
}

function primaryRows(action: ActionEntry): CallRow[] {
  const params = action.params ?? {}
  const rows: CallRow[] = []
  for (const key of PRIMARY_KEYS) {
    if (params[key] !== undefined)
      rows.push({ key, value: stringifyCallValue(params[key]) })
  }
  const expectedText = expectedTextValue(params.expectedText)
  if (expectedText)
    rows.push({ key: 'expected text', value: expectedText })
  return rows
}
