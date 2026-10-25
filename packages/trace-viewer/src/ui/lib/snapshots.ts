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

export interface PhaseTarget {
  action: ActionTraceEvent
  phase: ActionPhase
}

export interface PhaseTargets {
  action?: PhaseTarget
  before?: PhaseTarget
  after?: PhaseTarget
}

// Picks what each Before/Action/After tab shows, falling back to neighbouring actions
// when `has` says the action recorded nothing for that phase (same rules as upstream).
export function collectPhaseTargets(action: ActionTraceEvent | undefined, has: (callId: string, phase: ActionPhase) => boolean): PhaseTargets {
  if (!action)
    return {}
  const target = (a: ActionTraceEvent, phase: ActionPhase): PhaseTarget | undefined => has(a.callId, phase) ? { action: a, phase } : undefined

  let before = target(action, 'before')
  if (!before) {
    for (let a = previousActionByEndTime(action); a; a = previousActionByEndTime(a)) {
      if (a.endTime <= action.startTime) {
        before = target(a, 'after')
        if (before)
          break
      }
    }
  }

  let after = target(action, 'after')
  if (!after) {
    let last: ActionTraceEvent | undefined
    for (let a = nextActionByStartTime(action); a && a.startTime <= action.endTime; a = nextActionByStartTime(a)) {
      if (a.endTime > action.endTime || !has(a.callId, 'after'))
        continue
      if (last && last.endTime > a.endTime)
        continue
      last = a
    }
    after = last ? { action: last, phase: 'after' } : before
  }

  return { action: target(action, 'action') ?? after, before, after }
}

export function collectSnapshots(model: TraceModel | null, action: ActionEntry | undefined): Snapshots {
  if (!model)
    return {}
  const targets = collectPhaseTargets(action, (callId, phase) => model.hasDomSnapshotForCall(callId, phase))
  // Tabs falling back to the same target share one snapshot, so the selected action's point
  // reaches them too (upstream mutates the shared object the same way).
  const shared = new Map<PhaseTarget, Snapshot>()
  const toSnapshot = (t: PhaseTarget | undefined): Snapshot | undefined => {
    if (!t)
      return undefined
    if (!shared.has(t))
      shared.set(t, { callId: t.action.callId, phase: t.phase, point: t.action.point })
    return shared.get(t)
  }
  const snapshots = { action: toSnapshot(targets.action), before: toSnapshot(targets.before), after: toSnapshot(targets.after) }
  if (snapshots.action)
    snapshots.action.point = action?.point
  return snapshots
}

// ARIA mode counts a phase as recorded when it has a screenshot or an ARIA snapshot.
export function collectAriaTargets(model: TraceModel | null, action: ActionEntry | undefined): PhaseTargets {
  if (!model)
    return {}
  return collectPhaseTargets(action, (callId, phase) => !!model.screenshotForCall(callId, phase) || !!model.ariaSnapshotForCall(callId, phase))
}

export function snapshotUrl(traceUri: string, snapshot: Snapshot | undefined, options: { canvasFromScreenshot?: boolean } = {}): string | undefined {
  if (!snapshot)
    return undefined
  const params = new URLSearchParams()
  params.set('trace', traceUri)
  params.set('phase', snapshot.phase)
  if (snapshot.point) {
    params.set('pointX', String(snapshot.point.x))
    params.set('pointY', String(snapshot.point.y))
  }
  if (options.canvasFromScreenshot)
    params.set('shouldPopulateCanvasFromScreenshot', '1')
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
