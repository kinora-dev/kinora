import type { ActionEntry } from '@isomorphic/trace/entries'
import { renderTitleForCall } from '@isomorphic/protocolFormatter'

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
