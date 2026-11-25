import type { FailureCluster } from '../contracts/kinora'

// Runs that ran a cluster's tests without its failure before an open cluster reads as stopped.
export const STOPPED_AFTER_RUNS = 3

// Where a cluster stands, reconciling what people decided with what the runs show since.
// - failing: open (or never triaged) and still failing
// - stopped: open, but its tests ran STOPPED_AFTER_RUNS times without the failure
// - regressed: resolved, then failed again in a run started after the resolution
export type ClusterState = 'failing' | 'stopped' | 'regressed' | 'resolved' | 'ignored'

type ClusterLike = Pick<FailureCluster, 'lastSeen' | 'quietRuns' | 'triage'>

export function clusterState(c: ClusterLike): ClusterState {
  const t = c.triage
  if (t?.status === 'ignored')
    return 'ignored'
  if (t?.status === 'resolved')
    return t.resolvedAt && Date.parse(c.lastSeen) > Date.parse(t.resolvedAt) ? 'regressed' : 'resolved'
  return (c.quietRuns ?? 0) >= STOPPED_AFTER_RUNS ? 'stopped' : 'failing'
}

// Still owed a decision: failing, regressed, or stopped but never closed.
export function isOpenCluster(c: ClusterLike): boolean {
  const s = clusterState(c)
  return s === 'failing' || s === 'stopped' || s === 'regressed'
}

// A snooze for a while ends at snoozedUntil; one "until it recurs" ends with the next failure.
export function isSnoozed(c: ClusterLike, now = Date.now()): boolean {
  const t = c.triage
  if (!t?.snoozedAt)
    return false
  if (t.snoozedUntil)
    return now < Date.parse(t.snoozedUntil)
  return Date.parse(c.lastSeen) <= Date.parse(t.snoozedAt)
}

export const INBOX_QUEUES = ['all', 'untriaged', 'mine', 'regressed', 'stopped', 'snoozed'] as const
export type InboxQueue = typeof INBOX_QUEUES[number]

// The failure inbox's queues. Every queue but `snoozed` leaves snoozed clusters out.
export function inInboxQueue(c: ClusterLike, queue: InboxQueue, userId: string | undefined, now = Date.now()): boolean {
  if (!isOpenCluster(c))
    return false
  const snoozed = isSnoozed(c, now)
  if (queue === 'snoozed')
    return snoozed
  if (snoozed)
    return false
  switch (queue) {
    case 'all':
      return true
    case 'untriaged':
      return !c.triage && clusterState(c) === 'failing'
    case 'mine':
      return !!userId && c.triage?.assignee?.id === userId
    case 'regressed':
      return clusterState(c) === 'regressed'
    case 'stopped':
      return clusterState(c) === 'stopped'
  }
}

const STATE_RANK: Record<ClusterState, number> = { regressed: 0, failing: 1, stopped: 2, resolved: 3, ignored: 4 }

// Regressions first, then what still fails, then what stopped; most recent failure first within each.
export function byInboxPriority(a: ClusterLike, b: ClusterLike): number {
  return STATE_RANK[clusterState(a)] - STATE_RANK[clusterState(b)] || b.lastSeen.localeCompare(a.lastSeen)
}
