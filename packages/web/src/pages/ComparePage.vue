<script setup lang="ts">
import type { TestChange } from '@kinora/core'
import { formatDuration, formatPct, passRate } from '@kinora/core'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { StatBlock } from '@kinora/ui/stat-block'
import { ArrowLeft, ArrowRight } from '@lucide/vue'
import { computed } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import TestStatusBadge from '@/components/viz/TestStatusBadge.vue'
import { useCompareRuns, useManifest } from '@/composables/queries'
import { testLabel } from '@/lib/test-display'

const props = defineProps<{ projectId: string }>()
const route = useRoute()

const baseId = computed(() => String(route.query.base ?? ''))
const headId = computed(() => String(route.query.head ?? ''))

const { state: cmp, isLoading, error } = useCompareRuns(props.projectId, baseId.value, headId.value)
const { state: manifest } = useManifest()
const projectName = computed(
  () => manifest.value?.projects.find(p => p.id === props.projectId)?.name ?? props.projectId,
)

// Groups shown, in priority order. `unchanged` is hidden.
const GROUPS: { key: TestChange, label: string, tone: string }[] = [
  { key: 'broken', label: 'Broken', tone: 'text-fail' },
  { key: 'fixed', label: 'Fixed', tone: 'text-pass' },
  { key: 'newly-flaky', label: 'Newly flaky', tone: 'text-flaky' },
  { key: 'still-failing', label: 'Still failing', tone: 'text-fail' },
  { key: 'added', label: 'Added', tone: 'text-muted-foreground' },
  { key: 'removed', label: 'Removed', tone: 'text-muted-foreground' },
]

const groups = computed(() =>
  GROUPS.map(g => ({ ...g, tests: (cmp.value?.tests ?? []).filter(t => t.change === g.key) }))
    .filter(g => g.tests.length),
)

const noChanges = computed(() => !isLoading.value && !error.value && cmp.value && !groups.value.length)

const basePass = computed(() => (cmp.value ? passRate(cmp.value.base.counts) : 0))
const headPass = computed(() => (cmp.value ? passRate(cmp.value.head.counts) : 0))
const passDelta = computed(() => headPass.value - basePass.value)

function fmtDelta(ms: number): string {
  if (!ms)
    return '±0'
  return `${ms > 0 ? '+' : '-'}${formatDuration(Math.abs(ms))}`
}

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
function shortId(id: string): string {
  return id.slice(0, 8)
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <RouterLink
      :to="{ name: 'project', params: { projectId } }"
      class="flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-3.5" /> {{ projectName }}
    </RouterLink>

    <div v-if="error" class="rounded-lg border border-fail/30 bg-fail/5 px-5 py-4 font-mono text-sm text-fail">
      {{ String(error) }}
    </div>
    <template v-else-if="isLoading || !cmp">
      <Skeleton class="h-24 rounded-xl" />
      <Skeleton class="h-80 rounded-xl" />
    </template>

    <template v-else>
      <!-- Header -->
      <div class="flex flex-col gap-6">
        <div>
          <h1 class="text-2xl font-semibold tracking-tight">
            Run comparison
          </h1>
          <div class="mt-1 flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <span>{{ shortId(cmp.base.runId) }} · {{ dateFmt.format(new Date(cmp.base.startedAt)) }}</span>
            <ArrowRight class="size-3" />
            <span>{{ shortId(cmp.head.runId) }} · {{ dateFmt.format(new Date(cmp.head.startedAt)) }}</span>
          </div>
        </div>

        <div class="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-lg border border-border/70 bg-card/80 px-6 py-5">
          <StatBlock
            label="Pass rate"
            :value="`${formatPct(basePass)} → ${formatPct(headPass)}`"
            :tone="passDelta < 0 ? 'fail' : passDelta > 0 ? 'pass' : 'default'"
          />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Failed" :value="`${cmp.base.counts.unexpected} → ${cmp.head.counts.unexpected}`" :tone="cmp.head.counts.unexpected > cmp.base.counts.unexpected ? 'fail' : 'default'" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Flaky" :value="`${cmp.base.counts.flaky} → ${cmp.head.counts.flaky}`" :tone="cmp.head.counts.flaky > cmp.base.counts.flaky ? 'flaky' : 'default'" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Total" :value="`${cmp.base.counts.total} → ${cmp.head.counts.total}`" />
        </div>
      </div>

      <div v-if="noChanges" class="py-12 text-center font-mono text-sm text-pass">
        No changes between these runs.
      </div>

      <!-- Grouped diffs -->
      <div v-for="g in groups" :key="g.key" class="flex flex-col gap-2">
        <h2 class="font-mono text-[10px] uppercase tracking-wider" :class="g.tone">
          {{ g.label }} ({{ g.tests.length }})
        </h2>
        <RouterLink
          v-for="t in g.tests"
          :key="t.testKey"
          :to="{ name: 'test', params: { projectId }, query: { key: t.testKey } }"
          class="flex items-center justify-between gap-4 rounded-lg border border-border/70 bg-card/80 px-4 py-3 transition-colors hover:border-border"
        >
          <div class="min-w-0">
            <div class="truncate text-sm font-medium">
              {{ testLabel(t) }}
            </div>
            <div class="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {{ t.file }} · {{ t.projectName }}
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-3">
            <div class="flex items-center gap-1.5">
              <TestStatusBadge v-if="t.baseStatus" :status="t.baseStatus" />
              <span v-else class="font-mono text-[11px] text-muted-foreground">-</span>
              <ArrowRight class="size-3 text-muted-foreground" />
              <TestStatusBadge v-if="t.headStatus" :status="t.headStatus" />
              <span v-else class="font-mono text-[11px] text-muted-foreground">-</span>
            </div>
            <span
              v-if="t.durationDelta"
              class="w-16 text-right font-mono text-[11px] tabular-nums"
              :class="t.durationDelta > 0 ? 'text-flaky' : 'text-pass'"
            >{{ fmtDelta(t.durationDelta) }}</span>
          </div>
        </RouterLink>
      </div>
    </template>
  </div>
</template>
