import { useAsyncState } from '@vueuse/core'
import { computed } from 'vue'
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
