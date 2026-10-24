import type { Language } from '@isomorphic/locatorGenerators'
import type { ActionEntry } from '@isomorphic/trace/entries'
import type { SerializedValue } from '@protocol/structs'
import { asLocator } from '@isomorphic/locatorGenerators'
import { actionDuration, actionStatus, actionTitle } from './action'
import { stripAnsi } from './ansi'
import { formatMs } from './format'

export interface CallRow {
  key: string
  value: string
  // Handles and placeholders carry no value worth copying.
  copyable?: boolean
  tone?: 'default' | 'muted' | 'error'
}

export interface CallSummary {
  title: string
  subtitle: string
  status: string
  statusTone: 'default' | 'muted' | 'error'
  start: string
  duration: string
  primary: CallRow[]
  params: CallRow[]
  result: CallRow[]
  error?: string
}

export interface CallContext {
  sdkLanguage?: Language
  // Trace start, so the call's start time reads like the timeline's.
  startTime?: number
}

const PRIMARY_KEYS = ['selector', 'locator', 'url', 'value', 'text', 'expected', 'expression', 'timeout']

export function stringifyCallValue(value: unknown): string {
  if (typeof value === 'string')
    return value
  if (value === undefined)
    return 'undefined'
  if (value instanceof RegExp || value instanceof Date)
    return String(value)
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

const HANDLES: unknown[] = Array.from({ length: 10 }).fill('<handle>')

// Protocol values as upstream's callTab decodes them; handles render as a placeholder.
export function parseSerializedValue(value: SerializedValue): unknown {
  if (value.n !== undefined)
    return value.n
  if (value.s !== undefined)
    return value.s
  if (value.b !== undefined)
    return value.b
  if (value.v !== undefined) {
    const special: Record<NonNullable<SerializedValue['v']>, unknown> = {
      '-0': -0,
      '-Infinity': -Infinity,
      'Infinity': Infinity,
      'NaN': Number.NaN,
      'null': null,
      'undefined': undefined,
    }
    return special[value.v]
  }
  if (value.d !== undefined)
    return new Date(value.d)
  if (value.r !== undefined)
    return new RegExp(value.r.p, value.r.f)
  if (value.a !== undefined)
    return value.a.map(parseSerializedValue)
  if (value.o !== undefined)
    return Object.fromEntries(value.o.map(({ k, v }) => [k, parseSerializedValue(v)]))
  if (value.h !== undefined)
    return HANDLES[value.h]
  return '<object>'
}

export function callValue(action: ActionEntry, name: string, raw: unknown, sdkLanguage?: Language): CallRow {
  const isEval = action.method.includes('eval') || action.method === 'waitForFunction'
  let value: any = raw
  if (name === 'files')
    return { key: name, value: '<files>' }
  if (name === 'eventInit' || name === 'expectedValue' || (name === 'arg' && isEval)) {
    value = value?.value === undefined ? value : parseSerializedValue(value.value)
  }
  else if (name === 'value' && isEval && value && typeof value === 'object') {
    value = parseSerializedValue(value)
  }
  else if (name === 'received' && action.method === 'expect' && value && typeof value === 'object') {
    // Newer traces wrap the received SerializedValue as `{ value, ariaSnapshot }`.
    const serialized = 'value' in value || 'ariaSnapshot' in value ? value.value : value
    value = serialized === undefined ? undefined : parseSerializedValue(serialized)
  }
  if (name === 'selector' && typeof value === 'string')
    return { key: 'locator', value: asLocator(sdkLanguage ?? 'javascript', value), copyable: true }
  if (value && typeof value === 'object' && 'guid' in value)
    return { key: name, value: '<handle>' }
  const text = stringifyCallValue(value)
  return { key: name, value: text, copyable: value !== undefined && text !== '<handle>' }
}

export function callSummary(action: ActionEntry, context: CallContext = {}): CallSummary {
  const status = actionStatus(action)
  const params = action.params ?? {}
  const primaryKeys = PRIMARY_KEYS.filter(key => params[key] !== undefined)
  const primary = primaryKeys.map(key => callValue(action, key, params[key], context.sdkLanguage))
  const expectedText = expectedTextValue(params.expectedText)
  if (expectedText)
    primary.push({ key: 'expected text', value: expectedText, copyable: true })

  // `info` is waitForEventInfo bookkeeping, never useful to show.
  const rest = Object.entries(params)
    .filter(([key]) => !primaryKeys.includes(key) && key !== 'expectedText' && key !== 'info')
    .map(([key, value]) => callValue(action, key, value, context.sdkLanguage))

  const result = action.result === undefined
    ? []
    : action.result && typeof action.result === 'object' && !Array.isArray(action.result)
      ? Object.entries(action.result).map(([key, value]) => callValue(action, key, value, context.sdkLanguage))
      : [callValue(action, 'value', action.result, context.sdkLanguage)]

  return {
    title: actionTitle(action),
    subtitle: action.subtitle || `${action.class}.${action.method}`,
    status: status === 'error' ? 'error' : status === 'step' ? 'step' : 'ok',
    statusTone: status === 'error' ? 'error' : status === 'step' ? 'muted' : 'default',
    start: formatMs(action.startTime - (context.startTime ?? 0)),
    duration: callDuration(action),
    primary,
    params: rest,
    result,
    error: action.error?.message ? stripAnsi(action.error.message) : undefined,
  }
}

function callDuration(action: ActionEntry): string {
  if (action.endTime)
    return formatMs(actionDuration(action))
  return action.error ? 'Timed out' : 'Running'
}
