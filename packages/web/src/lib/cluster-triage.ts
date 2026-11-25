import type { ClusterState, FailureCluster, InboxQueue } from '@kinora/core'
import { clusterState } from '@kinora/core'

type ClusterLike = Pick<FailureCluster, 'lastSeen' | 'lastSeenMainline' | 'quietRuns' | 'triage'>

export function stateLabel(c: ClusterLike): string {
  const labels: Record<ClusterState, string> = {
    failing: 'Failing',
    stopped: `Not seen in ${c.quietRuns ?? 0} runs`,
    regressed: 'Regressed',
    resolved: 'Resolved',
    ignored: 'Ignored',
  }
  return labels[clusterState(c)]
}

export const STATE_TONE: Record<ClusterState, string> = {
  failing: 'border-fail/30 bg-fail/15 text-fail',
  stopped: 'border-pass/30 bg-pass/10 text-pass',
  regressed: 'border-fail/40 bg-fail/20 text-fail',
  resolved: 'border-pass/30 bg-pass/10 text-pass',
  ignored: 'border-border bg-muted text-muted-foreground',
}

export const QUEUE_LABEL: Record<InboxQueue, string> = {
  all: 'All open',
  untriaged: 'Needs triage',
  mine: 'Mine',
  regressed: 'Regressed',
  stopped: 'Stopped failing',
  snoozed: 'Snoozed',
}

const DAY = 24 * 60 * 60 * 1000

export const SNOOZE_OPTIONS = [
  { label: 'For 1 day', until: () => new Date(Date.now() + DAY).toISOString() },
  { label: 'For 1 week', until: () => new Date(Date.now() + 7 * DAY).toISOString() },
  { label: 'Until it fails again', until: () => 'recur' as const },
]

export function ago(iso: string, now = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000))
  if (minutes < 1)
    return 'just now'
  if (minutes < 60)
    return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24)
    return `${hours}h ago`
  return `${Math.round(hours / 24)}d ago`
}

export function initialOf(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase()
}
