<script setup lang="ts">
import {
  formatPct,
  HEALTH_WINDOW,
  incidentMarkers,
  latestRun,
  recentPassRate,
} from '@kinora/core'
import { Badge } from '@kinora/ui/badge'
import { HealthBadge } from '@kinora/ui/health-badge'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { Sparkline } from '@kinora/ui/sparkline'
import { StatBlock } from '@kinora/ui/stat-block'
import { ArrowLeft, Blocks, ChartArea, History, Settings } from '@lucide/vue'
import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import ErrorState from '@/components/app/ErrorState.vue'
import StatStripSkeleton from '@/components/app/StatStripSkeleton.vue'
import RunHistoryTable from '@/components/project/RunHistoryTable.vue'
import RunHealthBadge from '@/components/viz/RunHealthBadge.vue'
import { useProjectRuns, useProjectSummary } from '@/composables/queries'
import { useNewFeature } from '@/composables/useNewFeature'
import { useOrg } from '@/composables/useOrg'

const props = defineProps<{ projectId: string }>()

const { isAdmin } = useOrg()
const { isNew: componentsIsNew } = useNewFeature('components')
const { isNew: analyticsIsNew } = useNewFeature('analytics')
const { state: project, isLoading, error, execute: retrySummary } = useProjectSummary(props.projectId)

const before = useRouteQuery<string | null>('before', null)
const after = useRouteQuery<string | null>('after', null)
const { state: runPage, isLoading: runsLoading, error: runsError, execute: retryRuns } = useProjectRuns(
  props.projectId,
  () => before.value ?? undefined,
  () => after.value ?? undefined,
)

const latest = computed(() => (project.value ? latestRun(project.value) : undefined))
const rate = computed(() => recentPassRate(project.value?.runs ?? [], HEALTH_WINDOW))
const series = computed(() => project.value?.trend.map(t => t.passRate) ?? [])
const markers = computed(() => incidentMarkers(project.value?.trend ?? []))

function retry() {
  void retrySummary()
  if (runsError.value)
    void retryRuns()
}

function showNewer() {
  before.value = null
  after.value = runPage.value?.newer ?? null
}

function showOlder() {
  after.value = null
  before.value = runPage.value?.older ?? null
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <RouterLink
      :to="{ name: 'overview' }"
      class="flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-3.5" /> Overview
    </RouterLink>

    <ErrorState v-if="error" :error="error" @retry="retry()" />
    <template v-else-if="isLoading">
      <div class="flex flex-col gap-6" aria-hidden="true">
        <div class="flex flex-col gap-3">
          <div class="flex items-start justify-between gap-4">
            <Skeleton class="my-1 h-6 w-48" />
            <Skeleton class="h-5 w-20 rounded-full" />
          </div>
          <div class="flex h-4 items-center gap-4">
            <Skeleton class="h-3 w-28" />
            <Skeleton class="h-3 w-24" />
            <Skeleton class="h-3 w-20" />
          </div>
        </div>
        <StatStripSkeleton :count="3" />
      </div>
      <Skeleton class="h-[422px] rounded-xl" />
    </template>
    <div v-else-if="!project" class="text-sm text-muted-foreground">
      Project not found.
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex flex-col gap-6">
        <div class="flex flex-col gap-3">
          <div class="flex items-start justify-between gap-4">
            <div>
              <h1 class="text-2xl font-semibold tracking-tight">
                {{ project.name }}
              </h1>
              <p v-if="project.description" class="mt-1 text-sm text-muted-foreground">
                {{ project.description }}
              </p>
            </div>
            <RunHealthBadge v-if="latest" :run="latest" />
            <HealthBadge v-else health="empty" />
          </div>
          <div class="flex items-center justify-between gap-4">
            <div class="flex items-center gap-4">
              <RouterLink
                :to="{ name: 'tests', params: { projectId: project.id } }"
                class="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                <History class="size-3" />
                Per-test history
              </RouterLink>
              <RouterLink
                :to="{ name: 'components', params: { projectId: project.id } }"
                class="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                <Blocks class="size-3" />
                Components
                <Badge v-if="componentsIsNew" class="border-signal/30 bg-signal px-1.5 py-0.5 text-[9px] leading-none tracking-wider text-white">
                  New
                </Badge>
              </RouterLink>
              <RouterLink
                :to="{ name: 'analytics', params: { projectId: project.id } }"
                class="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                <ChartArea class="size-3" />
                Analytics
                <Badge v-if="analyticsIsNew" class="border-signal/30 bg-signal px-1.5 py-0.5 text-[9px] leading-none tracking-wider text-white">
                  New
                </Badge>
              </RouterLink>
            </div>
            <RouterLink
              v-if="isAdmin"
              :to="{ name: 'project-settings', params: { projectId: project.id } }"
              class="flex items-center gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              <Settings class="size-3" />
              Settings
            </RouterLink>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-lg border border-border/70 bg-card/80 px-6 py-5">
          <StatBlock
            :label="`Pass rate · last ${HEALTH_WINDOW}`"
            :value="latest ? formatPct(rate) : '-'"
          />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Runs" :value="project.runCount" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Tests" :value="latest?.counts.total ?? 0" />
          <div class="ml-auto w-40 text-muted-foreground">
            <Sparkline :values="series" :markers="markers" :height="44" :width="160" />
          </div>
        </div>
      </div>

      <!-- Run history -->
      <ErrorState v-if="runsError" :error="runsError" @retry="retryRuns()" />
      <Skeleton v-else-if="!runPage" class="h-[422px] rounded-xl" />
      <RunHistoryTable
        v-else
        :runs="runPage.runs"
        :total="project.runCount"
        :project-id="project.id"
        :has-newer="Boolean(runPage.newer)"
        :has-older="Boolean(runPage.older)"
        :loading="runsLoading"
        @newer="showNewer"
        @older="showOlder"
      />
    </template>
  </div>
</template>
