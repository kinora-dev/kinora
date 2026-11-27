<script setup lang="ts">
import type { ChartConfig } from '@kinora/ui/chart'
import { describeHealth, diagnose, durationStats, formatDuration, formatPct, HEALTH_WINDOW, stripAnsi, windowStats } from '@kinora/core'
import { Badge } from '@kinora/ui/badge'
import { Button } from '@kinora/ui/button'
import { LineChart } from '@kinora/ui/line-chart'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { StatBlock } from '@kinora/ui/stat-block'
import { Textarea } from '@kinora/ui/textarea'
import { ArrowLeft } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import A11yViolations from '@/components/a11y/A11yViolations.vue'
import CopyLinkButton from '@/components/app/CopyLinkButton.vue'
import ErrorState from '@/components/app/ErrorState.vue'
import StatStripSkeleton from '@/components/app/StatStripSkeleton.vue'
import IncidentScreenshots from '@/components/viz/IncidentScreenshots.vue'
import StatusTimeline from '@/components/viz/StatusTimeline.vue'
import StoryBadge from '@/components/viz/StoryBadge.vue'
import TestHealthBadge from '@/components/viz/TestHealthBadge.vue'
import TestStatusBadge from '@/components/viz/TestStatusBadge.vue'
import { useDemo, useTestHistory } from '@/composables/queries'
import { useQuarantine } from '@/composables/useQuarantine'
import { formatDateTimeLong } from '@/lib/format'
import { testLabel } from '@/lib/test-display'
import { traceViewerUrl } from '@/lib/trace'
import { commitUrl } from '@/lib/url'

const props = defineProps<{ projectId: string }>()
const route = useRoute()
const isDemo = useDemo()
const { byKey: quarantineByKey, savingKey, save, toggle, reload: reloadQuarantines } = useQuarantine(props.projectId)
const savingQuarantine = computed(() => savingKey.value !== null)
const quarantineReason = ref('')

const testKey = computed(() => {
  const k = route.query.key
  return Array.isArray(k) ? (k[0] ?? '') : (k ?? '')
})

const { state, isLoading, error, execute: reloadHistory } = useTestHistory(props.projectId, testKey)
// Quarantines fail with the same outage as the history, so a retry reloads both.
function retry() {
  void reloadHistory()
  void reloadQuarantines()
}

const project = computed(() => state.value?.project)
const history = computed(() => state.value?.history ?? undefined)
const quarantine = computed(() => quarantineByKey.value.get(testKey.value))
const recent = computed(() => windowStats(history.value?.points ?? []))
const health = computed(() => diagnose(history.value?.points ?? []))
const speed = computed(() => durationStats(history.value?.points ?? []))

// Passing runs only, one per x step: like the status timeline, a burst of runs on one day stays readable.
const passedRuns = computed(() =>
  (history.value?.points ?? []).filter(p => p.status === 'expected').map(p => ({ startedAt: p.startedAt, duration: p.duration })),
)
const durationConfig = { duration: { label: 'Duration', color: 'var(--signal)' } } satisfies ChartConfig
const durationTicks = computed(() => {
  const n = passedRuns.value.length
  // Every run while they fit, else 5 spread out: fewer than every run leaves uneven gaps.
  const count = n <= 8 ? n : 5
  return [...new Set(Array.from({ length: count }, (_, i) => Math.round(i * (n - 1) / Math.max(1, count - 1))))]
})
function runDate(i: number) {
  const p = passedRuns.value[i]
  return p ? new Date(p.startedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''
}
function runDateLong(i: number) {
  const p = passedRuns.value[i]
  return p ? formatDateTimeLong(p.startedAt) : ''
}
const formatMs = (ms: number) => formatDuration(Math.round(ms))
// The commit the diagnosis names (where the breakage started, or the one that both passed and
// failed), and the sentence split around its short sha so the sha can link to the commit.
const healthSha = computed(() => {
  const h = health.value
  return h.kind === 'broken' ? h.since.sha : h.kind === 'flaky' && h.reason.type === 'same-commit' ? h.reason.sha : undefined
})
const healthCommitHref = computed(() => {
  const sha = healthSha.value
  const run = sha ? project.value?.runs.find(r => r.git?.sha === sha && r.git.repoUrl) : undefined
  return commitUrl(run?.git)
})
const healthText = computed(() => {
  const text = describeHealth(health.value)
  const short = healthSha.value?.slice(0, 7)
  const at = short ? text.indexOf(short) : -1
  return at < 0 ? { before: text, sha: '', after: '' } : { before: text.slice(0, at), sha: short!, after: text.slice(at + short!.length) }
})

// Clusters this test shares with at least one other test: "the same error hits N others".
const relatedClusters = computed(() =>
  (state.value?.clusters ?? [])
    .filter(c => c.tests > 1)
    .sort((a, b) => b.tests - a.tests),
)
const labels = computed(() => new Map(Object.entries(state.value?.titles ?? {}).map(([key, t]) => [key, testLabel(t)])))

// Failures and flakes, most recent first.
const incidents = computed(() =>
  history.value
    ? [...history.value.points].reverse().filter(p => p.status === 'unexpected' || p.status === 'flaky')
    : [],
)

// A failing test can have hundreds of incidents; show the most recent by default, reveal the rest on demand.
const INCIDENT_LIMIT = 25
const showAll = ref(false)
const visibleIncidents = computed(() => (showAll.value ? incidents.value : incidents.value.slice(0, INCIDENT_LIMIT)))
watch(testKey, () => {
  showAll.value = false
})
watch(quarantine, (q) => {
  quarantineReason.value = q?.reason ?? ''
}, { immediate: true })

function saveQuarantine(reason?: string) {
  if (history.value)
    void save(history.value.testKey, reason)
}

function toggleQuarantine() {
  if (history.value)
    void toggle(history.value.testKey, quarantineReason.value)
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <RouterLink
      :to="{ name: 'tests', params: { projectId } }"
      class="flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-3.5" /> {{ project?.name ?? projectId }} tests
    </RouterLink>

    <ErrorState v-if="error" :error="error" @retry="retry()" />
    <template v-else-if="isLoading">
      <div class="flex flex-col gap-6" aria-hidden="true">
        <div class="flex items-start justify-between gap-4">
          <div class="flex flex-col">
            <Skeleton class="my-1 h-5 w-64" />
            <Skeleton class="mt-1 h-3.5 w-48" />
          </div>
          <Skeleton class="h-8 w-56" />
        </div>
        <StatStripSkeleton :count="6" caption />
      </div>
      <Skeleton class="h-[101px] rounded-xl" />
      <Skeleton class="h-[257px] rounded-xl" />
      <div class="flex flex-col gap-2" aria-hidden="true">
        <Skeleton v-for="i in 3" :key="i" class="h-24 rounded-lg" />
      </div>
    </template>
    <div v-else-if="!history" class="text-sm text-muted-foreground">
      Test not found in history.
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex flex-col gap-6">
        <div class="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
          <div class="min-w-0">
            <h1 class="text-xl font-semibold tracking-tight">
              {{ history.title }}
            </h1>
            <div v-if="history.titlePath.length > 2" class="mt-1 font-mono text-xs text-muted-foreground">
              {{ history.titlePath.slice(1, -1).join(' › ') }}
            </div>
            <div class="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {{ history.file }} · {{ history.projectName }}
            </div>
            <div v-if="history.codeOwners?.length || history.stories?.length" class="mt-2 flex flex-wrap gap-1.5">
              <Badge v-for="owner in history.codeOwners" :key="owner" class="border-signal/30 bg-signal/10 text-[10px] text-signal">
                {{ owner }}
              </Badge>
              <StoryBadge v-for="id in history.stories" :key="id" :project-id="projectId" :story-id="id" />
            </div>
          </div>
          <div class="flex shrink-0 flex-wrap items-center gap-2">
            <Badge v-if="quarantine" class="border-flaky/30 bg-flaky/10 text-flaky">
              Quarantined
            </Badge>
            <TestStatusBadge :status="history.lastStatus" />
            <Button
              variant="outline"
              size="sm"
              class="font-mono text-xs text-muted-foreground"
              :disabled="isDemo || savingQuarantine"
              @click="toggleQuarantine"
            >
              {{ quarantine ? 'Unquarantine' : 'Quarantine' }}
            </Button>
            <CopyLinkButton />
          </div>
        </div>

        <div v-if="quarantine" class="flex flex-col gap-3 rounded-lg border border-flaky/30 bg-flaky/5 px-4 py-3">
          <div class="font-mono text-xs text-flaky">
            Quarantined since {{ formatDateTimeLong(quarantine.createdAt) }}
          </div>
          <!-- Kept past retention, to check a fix against the failure that got the test quarantined. -->
          <div v-if="quarantine.pinnedTrace" class="flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-xs text-muted-foreground" data-testid="quarantine-trace">
            <span>Pinned {{ quarantine.pinnedTrace.status === 'flaky' ? 'flaky' : 'failing' }} run, {{ formatDateTimeLong(quarantine.pinnedTrace.startedAt) }}</span>
            <span v-if="quarantine.pinnedTrace.sha">@ {{ quarantine.pinnedTrace.sha.slice(0, 7) }}</span>
            <a
              :href="traceViewerUrl(quarantine.pinnedTrace.url)"
              target="_blank"
              rel="noopener noreferrer"
              class="text-signal hover:underline"
            >Open trace</a>
          </div>
          <Textarea
            v-model="quarantineReason"
            class="min-h-20 bg-background/70 text-sm"
            placeholder="Add a reason for the team..."
            :disabled="isDemo || savingQuarantine"
            maxlength="500"
          />
          <Button
            variant="outline"
            size="sm"
            class="self-start font-mono text-xs text-muted-foreground"
            :disabled="isDemo || savingQuarantine || quarantineReason.trim() === (quarantine.reason ?? '')"
            @click="saveQuarantine(quarantineReason)"
          >
            Save reason
          </Button>
        </div>

        <!-- Same window and rates as this test's row on the Tests page. -->
        <div class="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/80 px-6 py-5">
          <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">Last {{ HEALTH_WINDOW }} runs</span>
          <div class="flex flex-wrap items-center gap-x-10 gap-y-4">
            <StatBlock label="Runs" :value="Math.min(history.runs, HEALTH_WINDOW)" />
            <Separator orientation="vertical" class="h-10" />
            <StatBlock label="Pass rate" :value="formatPct(recent.passRate)" />
            <Separator orientation="vertical" class="h-10" />
            <StatBlock label="Flaky rate" :value="formatPct(recent.flakyRate)" :tone="recent.flakyRate ? 'flaky' : 'default'" />
            <Separator orientation="vertical" class="h-10" />
            <StatBlock label="Fail rate" :value="formatPct(recent.failRate)" :tone="recent.failRate ? 'fail' : 'default'" />
            <template v-if="speed">
              <Separator orientation="vertical" class="h-10" />
              <StatBlock label="Median duration" :value="formatDuration(speed.median)" data-testid="duration-median" />
              <Separator orientation="vertical" class="h-10" />
              <StatBlock label="P90 duration" :value="formatDuration(speed.p90)" />
            </template>
          </div>
          <div v-if="health.kind !== 'stable'" class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm" data-testid="test-health">
            <TestHealthBadge :health="health" />
            <span class="text-muted-foreground">
              {{ healthText.before }}<a
                v-if="healthText.sha && healthCommitHref"
                :href="healthCommitHref"
                target="_blank"
                rel="noopener noreferrer"
                class="font-mono text-signal hover:underline"
              >{{ healthText.sha }}</a><span v-else-if="healthText.sha" class="font-mono">{{ healthText.sha }}</span>{{ healthText.after }}
            </span>
            <RouterLink
              v-if="health.kind === 'broken'"
              :to="{ name: 'run', params: { projectId, runId: health.since.runId }, query: { test: history.testKey } }"
              class="font-mono text-xs text-signal hover:underline"
            >
              {{ health.runs === 1 ? 'Failing run' : 'First failing run' }}, {{ formatDateTimeLong(health.since.startedAt) }}
            </RouterLink>
          </div>
        </div>

        <!-- Identical to the block above until the test has more runs than the window. -->
        <div v-if="history.runs > HEALTH_WINDOW" class="flex flex-col gap-3 rounded-lg border border-border/70 bg-card/80 px-6 py-5">
          <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">All-time</span>
          <div class="flex flex-wrap items-center gap-x-10 gap-y-4">
            <StatBlock label="Runs" :value="history.runs" />
            <Separator orientation="vertical" class="h-10" />
            <StatBlock label="Pass rate" :value="formatPct(history.passRate)" />
            <Separator orientation="vertical" class="h-10" />
            <StatBlock label="Flaky rate" :value="formatPct(history.flakyRate)" :tone="history.flaky ? 'flaky' : 'default'" />
            <Separator orientation="vertical" class="h-10" />
            <StatBlock label="Fail rate" :value="formatPct(history.failRate)" :tone="history.failed ? 'fail' : 'default'" />
          </div>
        </div>
      </div>

      <!-- Accessibility check of the latest run, when the test has one (Storybook's a11y addon). -->
      <A11yViolations v-if="history.a11y" :report="history.a11y" class="rounded-lg border border-border/70 bg-card/80 px-6 py-5" />

      <!-- Timeline -->
      <div class="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/80 px-6 py-5">
        <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Status timeline</span>
          <span>{{ history.runs }} runs · oldest → newest</span>
        </div>
        <StatusTimeline :points="history.points" :project-id="projectId" :height="32" :test-key="history.testKey" />
      </div>

      <div v-if="passedRuns.length > 1" class="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/80 px-6 py-5" data-testid="test-duration">
        <div class="flex flex-wrap items-center justify-between gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Duration</span>
          <span>{{ passedRuns.length }} passed runs · oldest → newest</span>
        </div>
        <p class="text-xs text-muted-foreground">
          Failed and flaky runs are left out: their time adds up retries and timeouts.
        </p>
        <LineChart
          :data="passedRuns"
          :x="(_, i) => i"
          :series="['duration']"
          :config="durationConfig"
          :y-format="formatMs"
          :x-tick-format="runDate"
          :x-label-format="runDateLong"
          :x-ticks="durationTicks"
          class="h-40"
        />
      </div>

      <!-- Incidents -->
      <div class="flex flex-col gap-2">
        <h2 class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Failures & flakes ({{ incidents.length }})
        </h2>

        <div
          v-for="c in relatedClusters"
          :key="c.fingerprint"
          class="rounded-lg border border-flaky/30 bg-flaky/5 px-4 py-3"
        >
          <div class="font-mono text-xs text-flaky">
            Same error as {{ c.tests - 1 }} other {{ c.tests - 1 === 1 ? 'test' : 'tests' }}
          </div>
          <div class="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
            {{ c.title }}
          </div>
          <div class="mt-2 flex flex-col gap-1">
            <RouterLink
              v-for="key in c.testKeys.filter(k => k !== testKey)"
              :key="key"
              :to="{ name: 'test', params: { projectId }, query: { key } }"
              class="truncate font-mono text-[11px] text-muted-foreground hover:text-foreground"
            >
              {{ labels.get(key) ?? key }}
            </RouterLink>
          </div>
        </div>
        <!-- A card, not a link: the screenshot comparison inside it has its own buttons. -->
        <div
          v-for="p in visibleIncidents"
          :key="p.runId"
          class="rounded-lg border border-border/70 bg-card/80 px-4 py-3"
        >
          <div class="flex items-center justify-between gap-3">
            <RouterLink
              :to="{ name: 'run', params: { projectId, runId: p.runId }, query: { test: history.testKey } }"
              class="group flex items-center gap-2"
            >
              <TestStatusBadge :status="p.status" />
              <span class="font-mono text-xs text-muted-foreground group-hover:text-foreground group-hover:underline">{{ formatDateTimeLong(p.startedAt) }}</span>
            </RouterLink>
            <span v-if="p.retries" class="font-mono text-[11px] text-flaky">{{ p.retries }} retry</span>
          </div>
          <pre v-if="p.errorMessage" class="mt-2 overflow-x-auto rounded-md bg-fail/5 p-3 font-mono text-[11px] leading-relaxed text-fail">{{ stripAnsi(p.errorMessage) }}</pre>
          <IncidentScreenshots v-if="p.screenshots" :project-id="projectId" :run-id="p.runId" :test-key="history.testKey" :count="p.screenshots" />
        </div>

        <div v-if="!incidents.length" class="py-8 text-center font-mono text-sm text-pass">
          No failures recorded. Rock solid.
        </div>

        <Button
          v-if="incidents.length > INCIDENT_LIMIT"
          variant="outline"
          size="sm"
          class="mt-1 self-center font-mono text-xs text-muted-foreground"
          @click="showAll = !showAll"
        >
          {{ showAll ? 'Show less' : `Show all ${incidents.length}` }}
        </Button>
      </div>
    </template>
  </div>
</template>
