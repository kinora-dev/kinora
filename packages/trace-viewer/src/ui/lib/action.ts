import type { Language } from '@isomorphic/locatorGenerators'
import type { ActionEntry } from '@isomorphic/trace/entries'
import { formatProtocolParam, renderSubtitleForCall, renderTitleForCall } from '@isomorphic/protocolFormatter'
import { getMetainfo } from '@isomorphic/protocolMetainfo'
import { formatMs } from './format'

export type ActionStatus = 'ok' | 'error' | 'step'

export function actionTitle(action: ActionEntry): string {
  const title = renderTitleForCall({
    title: action.title,
    type: action.class,
    method: action.method,
    params: action.params,
  })
  return title || `${action.class}.${action.method}`
}

export function actionStatus(action: ActionEntry): ActionStatus {
  if (action.error?.message)
    return 'error'
  if (action.class === 'Test')
    return 'step'
  return 'ok'
}

export function actionDuration(action: ActionEntry): number | undefined {
  if (action.endTime && action.startTime)
    return action.endTime - action.startTime
  return undefined
}

export interface LogLine {
  message: string
  duration: string
}

// Each log line lasts until the next timed one (`time` is -1 when not recorded), the last until the action ends.
export function actionLogLines(action: ActionEntry): LogLine[] {
  return action.log.map((entry, i) => {
    if (entry.time === -1)
      return { duration: '', message: entry.message }
    const next = action.log.slice(i + 1).find(e => e.time !== -1)?.time
    const end = next ?? (action.endTime > 0 ? action.endTime : undefined)
    return { duration: end === undefined ? '-' : formatMs(end - entry.time), message: entry.message }
  })
}

export interface TitlePart {
  text: string
  // A value substituted into the title template, rendered emphasized like upstream.
  param?: boolean
}

export function actionTitleParts(action: ActionEntry, sdkLanguage?: Language): { parts: TitlePart[], subtitle?: string } {
  const format = (action.title ?? getMetainfo({ type: action.class, method: action.method })?.title ?? action.method).replace(/\n/g, ' ')
  const parts: TitlePart[] = []
  let index = 0
  for (const match of format.matchAll(/\{([^}]+)\}/g)) {
    if (match.index > index)
      parts.push({ text: format.slice(index, match.index) })
    const value = formatProtocolParam(action.params, match[1], sdkLanguage)
    // A value that opens the title is the title itself, not a detail to emphasize.
    parts.push(value === undefined ? { text: match[0] } : { text: value, param: match.index > 0 })
    index = match.index + match[0].length
  }
  if (index < format.length)
    parts.push({ text: format.slice(index) })
  const subtitle = renderSubtitleForCall({ type: action.class, method: action.method, params: action.params, subtitle: action.subtitle }, sdkLanguage)
  return { parts: parts.length ? parts : [{ text: actionTitle(action) }], subtitle }
}

// Duration column text: unfinished actions read "Timed out" when they errored, "-" otherwise.
export function actionTime(action: ActionEntry): string {
  if (action.endTime)
    return formatMs(action.endTime - action.startTime)
  return action.error ? 'Timed out' : '-'
}

export function isSkippedStep(action: ActionEntry): boolean {
  return action.class === 'Test' && action.method === 'test.step' && !!action.annotations?.some(a => a.type === 'skip')
}

interface TreeItem { depth: number }

// Rows matching `matches`, plus the ancestors that lead to them so the tree keeps its shape.
// Ancestors that only make it in as context are flagged.
export function filterTree<T extends TreeItem>(items: T[], matches: (item: T) => boolean): { item: T, context: boolean }[] {
  const out: { item: T, context: boolean }[] = []
  const ancestors: T[] = []
  const added = new Set<T>()
  for (const item of items) {
    while (ancestors.length && ancestors[ancestors.length - 1].depth >= item.depth)
      ancestors.pop()
    if (matches(item)) {
      for (const ancestor of ancestors) {
        if (!added.has(ancestor)) {
          added.add(ancestor)
          out.push({ item: ancestor, context: true })
        }
      }
      added.add(item)
      out.push({ item, context: false })
    }
    ancestors.push(item)
  }
  return out
}
