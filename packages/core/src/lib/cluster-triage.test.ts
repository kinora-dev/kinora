import type { ClusterTriage, FailureCluster } from '../contracts/kinora'
import { describe, expect, it } from 'vitest'
import { byInboxPriority, clusterState, inInboxQueue, isOpenCluster, isSnoozed, STOPPED_AFTER_RUNS } from './cluster-triage'

const NOW = Date.parse('2026-03-10T12:00:00Z')

function cluster(lastSeen: string, triage?: Partial<ClusterTriage>, quietRuns = 0): Pick<FailureCluster, 'lastSeen' | 'quietRuns' | 'triage'> {
  return { lastSeen, quietRuns, triage: triage && { status: 'open', updatedAt: '2026-03-01T00:00:00Z', ...triage } }
}

describe('clusterState', () => {
  it('reads an untriaged cluster as failing until its tests pass for a few runs', () => {
    expect(clusterState(cluster('2026-03-09T00:00:00Z'))).toBe('failing')
    expect(clusterState(cluster('2026-03-09T00:00:00Z', undefined, STOPPED_AFTER_RUNS - 1))).toBe('failing')
    expect(clusterState(cluster('2026-03-09T00:00:00Z', undefined, STOPPED_AFTER_RUNS))).toBe('stopped')
  })

  it('keeps a resolved cluster resolved until a run started after the resolution fails', () => {
    const resolved = { status: 'resolved' as const, resolvedAt: '2026-03-05T00:00:00Z' }
    expect(clusterState(cluster('2026-03-04T00:00:00Z', resolved))).toBe('resolved')
    expect(clusterState(cluster('2026-03-05T00:00:00Z', resolved))).toBe('resolved')
    expect(clusterState(cluster('2026-03-06T00:00:00Z', resolved))).toBe('regressed')
  })

  it('never reopens an ignored cluster', () => {
    expect(clusterState(cluster('2026-03-09T00:00:00Z', { status: 'ignored' }))).toBe('ignored')
    expect(isOpenCluster(cluster('2026-03-09T00:00:00Z', { status: 'ignored' }))).toBe(false)
  })
})

describe('isSnoozed', () => {
  it('ends a timed snooze at its date', () => {
    const c = cluster('2026-03-09T00:00:00Z', { snoozedAt: '2026-03-09T00:00:00Z', snoozedUntil: '2026-03-11T00:00:00Z' })
    expect(isSnoozed(c, NOW)).toBe(true)
    expect(isSnoozed(c, Date.parse('2026-03-12T00:00:00Z'))).toBe(false)
  })

  it('ends a snooze until it recurs with the next failure', () => {
    const triage = { snoozedAt: '2026-03-08T00:00:00Z' }
    expect(isSnoozed(cluster('2026-03-07T00:00:00Z', triage), NOW)).toBe(true)
    expect(isSnoozed(cluster('2026-03-09T00:00:00Z', triage), NOW)).toBe(false)
  })
})

describe('inInboxQueue', () => {
  const me = 'u1'
  const untriaged = cluster('2026-03-09T00:00:00Z')
  const mine = cluster('2026-03-09T00:00:00Z', { assignee: { id: me, name: 'Me' } })
  const regressed = cluster('2026-03-09T00:00:00Z', { status: 'resolved', resolvedAt: '2026-03-01T00:00:00Z' })
  const stopped = cluster('2026-03-01T00:00:00Z', undefined, STOPPED_AFTER_RUNS)
  const snoozed = cluster('2026-03-01T00:00:00Z', { snoozedAt: '2026-03-02T00:00:00Z' })
  const resolved = cluster('2026-03-01T00:00:00Z', { status: 'resolved', resolvedAt: '2026-03-02T00:00:00Z' })

  function queue(q: Parameters<typeof inInboxQueue>[1]) {
    return [untriaged, mine, regressed, stopped, snoozed, resolved].map(c => inInboxQueue(c, q, me, NOW))
  }

  it('sorts open clusters into their queues', () => {
    expect(queue('all')).toEqual([true, true, true, true, false, false])
    expect(queue('untriaged')).toEqual([true, false, false, false, false, false])
    expect(queue('mine')).toEqual([false, true, false, false, false, false])
    expect(queue('regressed')).toEqual([false, false, true, false, false, false])
    expect(queue('stopped')).toEqual([false, false, false, true, false, false])
    expect(queue('snoozed')).toEqual([false, false, false, false, true, false])
  })

  it('lists regressions first, then the latest failures', () => {
    const sorted = [stopped, untriaged, regressed].sort(byInboxPriority)
    expect(sorted).toEqual([regressed, untriaged, stopped])
  })
})
