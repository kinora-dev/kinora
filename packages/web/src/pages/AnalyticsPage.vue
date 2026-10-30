<script setup lang="ts">
import type { ChartConfig } from '@kinora/ui/chart'
import { formatPct } from '@kinora/core'
import { Button } from '@kinora/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@kinora/ui/card'
import { SegmentedControl } from '@kinora/ui/segmented-control'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { StackedAreaChart } from '@kinora/ui/stacked-area-chart'
import { StatBlock } from '@kinora/ui/stat-block'
import { ArrowLeft } from '@lucide/vue'
import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import CopyLinkButton from '@/components/app/CopyLinkButton.vue'
import ErrorState from '@/components/app/ErrorState.vue'
import StatStripSkeleton from '@/components/app/StatStripSkeleton.vue'
import FilterCombobox from '@/components/FilterCombobox.vue'
import { useProjectAnalytics } from '@/composables/queries'
import { useNewFeature } from '@/composables/useNewFeature'

const props = defineProps<{ projectId: string }>()

useNewFeature('analytics').markSeen()

const RANGES = [{ value: '30', label: '30 days' }, { value: '90', label: '90 days' }] as const
const range = useRouteQuery<string>('range', '30')
const days = computed(() => (range.value === '90' ? 90 : 30))
const branch = useRouteQuery('branch', 'all')

const { state, isLoading, error, execute: retry } = useProjectAnalytics(
  props.projectId,
  days,
  () => (branch.value === 'all' ? undefined : branch.value),
)

// The branch list only covers the range, so keep a selected branch listed even with no runs left.
const branches = computed(() => {
  const list = state.value?.branches ?? []
  return branch.value !== 'all' && !list.includes(branch.value) ? [...list, branch.value] : list
})

// Bottom to top: failures sit on the baseline, where a change reads first.
const SERIES = ['unexpected', 'flaky', 'expected']
const outcomesConfig = {
  expected: { label: 'Passed', color: 'var(--pass)' },
  flaky: { label: 'Flaky', color: 'var(--flaky)' },
  unexpected: { label: 'Failed', color: 'var(--fail)' },
} satisfies ChartConfig

const outcomes = computed(() => state.value?.outcomes ?? [])
const totals = computed(() => outcomes.value.reduce(
  (t, b) => ({ runs: t.runs + b.runs, expected: t.expected + b.expected, flaky: t.flaky + b.flaky, unexpected: t.unexpected + b.unexpected, incidents: t.incidents + b.incidents }),
  { runs: 0, expected: 0, flaky: 0, unexpected: 0, incidents: 0 },
))
// Rates over the results that ran: skipped tests say nothing about stability.
const results = computed(() => totals.value.expected + totals.value.flaky + totals.value.unexpected)
const rate = (n: number) => (results.value ? formatPct(n / results.value) : '-')

// Same bucketing as the server: local days for 30 days, weeks starting on Monday for 90.
const per = computed(() => (days.value > 30 ? 'week' : 'day'))
// A bucket is plotted at local midnight of its first day.
const at = (date: string) => new Date(`${date}T00:00:00`).getTime()
function bucketStart(t: number): Date {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  if (per.value === 'week')
    d.setDate(d.getDate() - (d.getDay() + 6) % 7)
  return d
}
// Every bucket of the range, oldest first: the axis spans the whole range, not only the buckets
// that have runs. Stepping with setDate stays on midnight across DST changes.
const buckets = computed(() => {
  const step = per.value === 'week' ? 7 : 1
  const end = bucketStart(Date.now()).getTime()
  const list: number[] = []
  for (const d = bucketStart(Date.now() - days.value * 86_400_000); d.getTime() <= end; d.setDate(d.getDate() + step))
    list.push(d.getTime())
  return list
})
const xDomain = computed((): [number, number] => [buckets.value[0], buckets.value.at(-1)!])

const shortDate = (t: number) => new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
function bucketLabel(t: number): string {
  if (per.value === 'day')
    return shortDate(t)
  const last = new Date(t)
  last.setDate(last.getDate() + 6)
  return `${shortDate(t)} - ${shortDate(last.getTime())}`
}

// The buckets holding an environment incident: what explains a dip in the chart.
const incidentBuckets = computed(() => outcomes.value.filter(b => b.incidents > 0).map(b => bucketLabel(at(b.date))))
</script>

<template>
  <div class="flex flex-col gap-8">
    <RouterLink
      :to="{ name: 'project', params: { projectId } }"
      class="flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-3.5" /> {{ state?.project.name ?? projectId }}
    </RouterLink>

    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 class="text-2xl font-semibold tracking-tight">
          Analytics
        </h1>
        <p class="mt-1 text-sm text-muted-foreground">
          How {{ state?.project.name ?? 'this project' }} evolves over the last {{ days }} days, every run included.
        </p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button v-if="branch !== 'all'" variant="ghost" size="sm" class="h-9 font-mono text-xs" @click="branch = 'all'">
          Clear
        </Button>
        <FilterCombobox
          v-if="branches.length > 1 || branch !== 'all'"
          v-model="branch"
          :options="branches"
          all-label="All branches"
          search-placeholder="Search branch..."
          trigger-class="w-44"
        />
        <SegmentedControl v-model="range" :options="RANGES" />
        <CopyLinkButton class="shrink-0" />
      </div>
    </div>

    <ErrorState v-if="error" :error="error" @retry="retry()" />
    <template v-else-if="isLoading && !state">
      <StatStripSkeleton :count="5" />
      <Skeleton class="h-[372px] rounded-xl" />
    </template>

    <template v-else-if="state">
      <div role="group" aria-label="Range totals" class="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-lg border border-border/70 bg-card/80 px-6 py-5">
        <StatBlock label="Runs" :value="totals.runs" />
        <Separator orientation="vertical" class="h-10" />
        <StatBlock label="Test results" :value="results.toLocaleString()" />
        <Separator orientation="vertical" class="h-10" />
        <StatBlock label="Passed" :value="rate(totals.expected)" />
        <Separator orientation="vertical" class="h-10" />
        <StatBlock label="Flaky" :value="rate(totals.flaky)" :tone="totals.flaky ? 'flaky' : 'default'" />
        <Separator orientation="vertical" class="h-10" />
        <StatBlock label="Failed" :value="rate(totals.unexpected)" :tone="totals.unexpected ? 'fail' : 'default'" />
        <template v-if="totals.incidents">
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Env. incidents" :value="totals.incidents" />
        </template>
      </div>

      <Card>
        <CardHeader class="flex flex-row flex-wrap items-start justify-between gap-4">
          <div class="flex flex-col gap-1.5">
            <CardTitle>Test outcomes</CardTitle>
            <CardDescription>Share of passed, flaky and failed results per {{ per }}. Hover for the counts.</CardDescription>
          </div>
          <div class="flex items-center gap-4 font-mono text-xs text-muted-foreground">
            <span v-for="key in [...SERIES].reverse()" :key="key" class="flex items-center gap-1.5">
              <span class="size-2.5 rounded-xs" :style="{ background: outcomesConfig[key as keyof typeof outcomesConfig].color }" />
              {{ outcomesConfig[key as keyof typeof outcomesConfig].label }}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <StackedAreaChart
            v-if="outcomes.length > 1"
            :data="outcomes"
            :x="d => at(d.date)"
            :series="SERIES"
            :config="outcomesConfig"
            normalize
            :x-tick-format="shortDate"
            :x-label-format="bucketLabel"
            :x-domain="xDomain"
            :x-ticks="buckets"
            class="h-64"
          />
          <p v-else class="py-10 text-center font-mono text-xs text-muted-foreground">
            {{ outcomes.length ? `Only one ${per} with runs in this range: not enough to draw a trend.` : 'No runs in this range.' }}
          </p>
          <p v-if="incidentBuckets.length" data-testid="incident-buckets" class="mt-3 font-mono text-xs text-muted-foreground">
            Environment incidents on {{ incidentBuckets.join(', ') }}: the app under test was down, so their failures say nothing about the tests.
          </p>
        </CardContent>
      </Card>
    </template>
  </div>
</template>
