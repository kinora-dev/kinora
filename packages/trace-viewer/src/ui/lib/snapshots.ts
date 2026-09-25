import type { ActionEntry } from '@isomorphic/trace/entries'
import type { TraceModel } from '@isomorphic/trace/traceModel'
import type { ActionPhase, ActionTraceEvent } from '@trace/trace'
import { nextActionByStartTime, previousActionByEndTime } from '@isomorphic/trace/traceModel'

export interface Snapshot {
  callId: string
  phase: ActionPhase
  point?: { x: number, y: number }
}

export interface Snapshots {
  action?: Snapshot
  before?: Snapshot
  after?: Snapshot
}

export type SnapshotTab = 'before' | 'action' | 'after'

function createSnapshot(model: TraceModel, action: ActionTraceEvent | undefined, phase: ActionPhase): Snapshot | undefined {
  if (!action || !model.hasDomSnapshotForCall(action.callId, phase))
    return undefined
  return { callId: action.callId, phase, point: action.point }
}

export function collectSnapshots(model: TraceModel | null, action: ActionEntry | undefined): Snapshots {
  if (!model || !action)
    return {}

  let before = createSnapshot(model, action, 'before')
  if (!before) {
    for (let a = previousActionByEndTime(action); a; a = previousActionByEndTime(a)) {
      if (a.endTime <= action.startTime) {
        before = createSnapshot(model, a, 'after')
        if (before)
          break
      }
    }
  }

  let after = createSnapshot(model, action, 'after')
  if (!after) {
    let last: ActionTraceEvent | undefined
    for (let a = nextActionByStartTime(action); a && a.startTime <= action.endTime; a = nextActionByStartTime(a)) {
      if (a.endTime > action.endTime || !model.hasDomSnapshotForCall(a.callId, 'after'))
        continue
      if (last && last.endTime > a.endTime)
        continue
      last = a
    }
    after = last ? createSnapshot(model, last, 'after') : before
  }

  const action_ = createSnapshot(model, action, 'action') ?? after
  return { action: action_, before, after }
}

export function snapshotUrl(traceUri: string, snapshot: Snapshot | undefined): string | undefined {
  if (!snapshot)
    return undefined
  const params = new URLSearchParams()
  params.set('trace', traceUri)
  params.set('phase', snapshot.phase)
  if (snapshot.point) {
    params.set('pointX', String(snapshot.point.x))
    params.set('pointY', String(snapshot.point.y))
  }
  return new URL(`snapshot/${encodeURIComponent(snapshot.callId)}?${params.toString()}`, location.href).toString()
}

export function snapshotInfoUrl(traceUri: string, snapshot: Snapshot | undefined): string | undefined {
  if (!snapshot)
    return undefined
  const params = new URLSearchParams()
  params.set('trace', traceUri)
  params.set('phase', snapshot.phase)
  return new URL(`snapshotInfo/${encodeURIComponent(snapshot.callId)}?${params.toString()}`, location.href).toString()
}
