<script setup lang="ts">
import type { OverviewProject } from '@kinora/core'
import { formatDuration, formatPct, HEALTH_WINDOW, incidentMarkers, latestRun, recentPassRate } from '@kinora/core'
import { Card } from '@kinora/ui/card'
import { HealthBadge } from '@kinora/ui/health-badge'
import { RunStrip } from '@kinora/ui/run-strip'
import { Sparkline } from '@kinora/ui/sparkline'
import { ArrowRight } from '@lucide/vue'
import { computed } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import RunHealthBadge from '@/components/viz/RunHealthBadge.vue'

const props = defineProps<{ project: OverviewProject }>()

const router = useRouter()

const latest = computed(() => latestRun(props.project))
const rate = computed(() => recentPassRate(props.project.runs, HEALTH_WINDOW))
const series = computed(() => props.project.trend.map(t => t.passRate))
const markers = computed(() => incidentMarkers(props.project.trend))

const rel = computed(() => {
  if (!latest.value)
    return ''
  const diff = Date.now() - Date.parse(latest.value.startedAt)
  const h = Math.round(diff / 3_600_000)
  if (h < 1)
    return 'just now'
  if (h < 24)
    return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
})
</script>

<template>
  <Card class="group flex flex-col gap-0 overflow-hidden p-0 transition-colors hover:border-border">
    <!-- Header -->
    <div class="flex items-start justify-between gap-3 p-5 pb-4">
      <div class="min-w-0">
        <RouterLink
          :to="{ name: 'project', params: { projectId: project.id } }"
          class="flex items-center gap-1.5 truncate text-[15px] font-semibold tracking-tight hover:text-foreground group-hover:underline"
        >
          {{ project.name }}
          <ArrowRight class="size-3.5 shrink-0 -translate-x-1 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-60" />
        </RouterLink>
        <p v-if="project.description" class="mt-0.5 truncate text-xs text-muted-foreground">
          {{ project.description }}
        </p>
      </div>
      <RunHealthBadge v-if="latest" :run="latest" />
      <HealthBadge v-else health="empty" />
    </div>

    <!-- Pass rate + sparkline -->
    <div class="flex items-end justify-between gap-4 px-5">
      <div class="flex flex-col gap-1">
        <span class="font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Pass rate <span class="text-muted-foreground/60">· last {{ HEALTH_WINDOW }}</span>
        </span>
        <span class="font-mono text-3xl font-semibold tabular-nums leading-none">
          {{ formatPct(rate) }}
        </span>
      </div>
      <div class="w-1/2 max-w-[220px] text-muted-foreground">
        <Sparkline :values="series" :markers="markers" :height="40" class="w-full" />
      </div>
    </div>

    <!-- Run strip -->
    <div class="px-5 pt-4">
      <RunStrip
        :runs="project.runs"
        :limit="HEALTH_WINDOW"
        @select="r => router.push({ name: 'run', params: { projectId: r.projectId, runId: r.runId } })"
      />
    </div>

    <!-- Footer -->
    <div
      class="mt-4 flex items-center justify-between gap-3 border-t border-border/70 bg-muted/30 px-5 py-2.5 font-mono text-[11px] text-muted-foreground"
    >
      <span class="tabular-nums">{{ project.runCount }} runs</span>
      <span v-if="latest" class="tabular-nums">
        {{ latest.counts.total }} tests &middot; {{ formatDuration(latest.duration) }}
      </span>
      <span class="tabular-nums">{{ rel }}</span>
    </div>
  </Card>
</template>
