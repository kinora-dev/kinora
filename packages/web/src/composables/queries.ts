import type { MaybeRefOrGetter } from 'vue'
import { useAsyncState } from '@vueuse/core'
import { computed, toValue, watch } from 'vue'
import { reportQueryError } from '@/lib/errors'
import { trpc } from '@/lib/trpc'

// Shared by every page query: run on creation, and keep expected failures out of the global error handler.
const QUERY_OPTIONS = { immediate: true, onError: reportQueryError } as const

// App-level server capabilities (SMTP, Slack OAuth, demo). Static per deployment, so fetch once + share.
let serverConfig: ReturnType<typeof loadServerConfig> | undefined
function loadServerConfig() {
  return useAsyncState(() => trpc.config.get.query(), null, QUERY_OPTIONS)
}
export function useServerConfig() {
  serverConfig ??= loadServerConfig()
  return serverConfig
}

// Read-only public demo: drives the banner + disables mutation controls.
export function useDemo() {
  const { state } = useServerConfig()
  return computed(() => state.value?.demo ?? false)
}

export function useManifest() {
  return useAsyncState(() => trpc.dashboard.manifest.query(), null, QUERY_OPTIONS)
}

export function useOverview(branch: MaybeRefOrGetter<string | undefined>, tag: MaybeRefOrGetter<string | undefined>) {
  const query = useAsyncState(
    () => trpc.dashboard.overview.query({ branch: toValue(branch), tag: toValue(tag) }),
    null,
    { ...QUERY_OPTIONS, resetOnExecute: false },
  )
  watch(() => [toValue(branch), toValue(tag)], () => void query.execute())
  return query
}

export function useRun(projectId: string, runId: string) {
  return useAsyncState(() => trpc.dashboard.run.query({ projectId, runId }), null, QUERY_OPTIONS)
}

export function useProjectHistory(projectId: string) {
  return useAsyncState(
    () => trpc.dashboard.projectHistory.query({ projectId }),
    { project: null, histories: [], clusters: [] },
    QUERY_OPTIONS,
  )
}

// The test history page: one test with every point (the project history trims them) and the
// failure clusters it shares. Refetches when the test changes.
export function useTestHistory(projectId: string, testKey: MaybeRefOrGetter<string>) {
  const query = useAsyncState(
    async () => (toValue(testKey) ? trpc.dashboard.testHistory.query({ projectId, testKey: toValue(testKey) }) : null),
    null,
    QUERY_OPTIONS,
  )
  watch(() => toValue(testKey), () => void query.execute())
  return query
}

// The Components page: only the tests that mount stories.
export function useComponentHistory(projectId: string) {
  return useAsyncState(
    () => trpc.dashboard.componentHistory.query({ projectId }),
    { project: null, histories: [], clusters: [] },
    QUERY_OPTIONS,
  )
}

// Refetches when the range or branch changes. `branch` undefined = every branch. Buckets follow
// the browser's time zone, so a day on the chart is the viewer's day.
export function useProjectAnalytics(projectId: string, days: MaybeRefOrGetter<30 | 90>, branch: MaybeRefOrGetter<string | undefined>) {
  const timeZone = new Intl.DateTimeFormat().resolvedOptions().timeZone
  const query = useAsyncState(
    () => trpc.dashboard.analytics.query({ projectId, days: toValue(days), branch: toValue(branch), timeZone }),
    null,
    { ...QUERY_OPTIONS, resetOnExecute: false },
  )
  watch(() => [toValue(days), toValue(branch)], () => void query.execute())
  return query
}

export function useQuarantines(projectId: string) {
  return useAsyncState(() => trpc.dashboard.quarantines.query({ projectId }), [], QUERY_OPTIONS)
}

export function useCompareRuns(projectId: string, baseRunId: string, headRunId: string) {
  return useAsyncState(
    () => trpc.dashboard.compareRuns.query({ projectId, baseRunId, headRunId }),
    null,
    QUERY_OPTIONS,
  )
}

export function useAdminOverview() {
  return useAsyncState(() => trpc.admin.overview.query(), null, QUERY_OPTIONS)
}

export function useAdminTimeseries() {
  return useAsyncState(() => trpc.admin.timeseries.query(), { signups: [], runs: [] }, QUERY_OPTIONS)
}

export function useAdminAccounts() {
  return useAsyncState(() => trpc.admin.accounts.query(), [], QUERY_OPTIONS)
}
