import type { ActionEntry } from '@isomorphic/trace/entries'
import { renderTitleForCall } from '@isomorphic/protocolFormatter'
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
