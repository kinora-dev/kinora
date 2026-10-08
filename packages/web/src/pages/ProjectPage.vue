<script setup lang="ts">
import {
  formatPct,
  HEALTH_WINDOW,
  latestRun,
  recentPassRate,
  runHealth,
  sortedRuns,
  trend,
} from '@kinora/core'
import { HealthBadge } from '@kinora/ui/health-badge'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { Sparkline } from '@kinora/ui/sparkline'
import { StatBlock } from '@kinora/ui/stat-block'
import { ArrowLeft, Blocks, History, Settings } from '@lucide/vue'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import ErrorState from '@/components/app/ErrorState.vue'
import RunHistoryTable from '@/components/project/RunHistoryTable.vue'
import { useManifest } from '@/composables/queries'
import { useOrg } from '@/composables/useOrg'

const props = defineProps<{ projectId: string }>()

const { isAdmin } = useOrg()
const { state: manifest, isLoading, error, execute: retry } = useManifest()

const project = computed(() =>
  manifest.value?.projects.find(p => p.id === props.projectId),
)
const runs = computed(() => (project.value ? sortedRuns(project.value) : []))
const latest = computed(() => (project.value ? latestRun(project.value) : undefined))
const rate = computed(() => recentPassRate(runs.value, HEALTH_WINDOW))
const series = computed(() => (project.value ? trend(project.value).map(t => t.passRate) : []))
const health = computed(() => (latest.value ? runHealth(latest.value.counts) : 'empty'))
</script>

<template>
  <div class="flex flex-col gap-8">
    <RouterLink
      :to="{ name: 'overview' }"
      class="flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-3.5" /> overview
    </RouterLink>

    <ErrorState v-if="error" :error="error" @retry="retry()" />
    <template v-else-if="isLoading">
      <Skeleton class="h-28 rounded-xl" />
      <Skeleton class="h-96 rounded-xl" />
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
            <HealthBadge :health="health" />
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
          <StatBlock label="Runs" :value="runs.length" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Tests" :value="latest?.counts.total ?? 0" />
          <div class="ml-auto w-40 text-muted-foreground">
            <Sparkline :values="series" :height="44" :width="160" />
          </div>
        </div>
      </div>

      <!-- Run history -->
      <RunHistoryTable :runs="runs" :project-id="project.id" />
    </template>
  </div>
</template>
