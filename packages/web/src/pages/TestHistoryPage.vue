<script setup lang="ts">
import { formatPct, HEALTH_WINDOW, stripAnsi, windowStats } from '@kinora/core'
import { Badge } from '@kinora/ui/badge'
import { Button } from '@kinora/ui/button'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { StatBlock } from '@kinora/ui/stat-block'
import { Textarea } from '@kinora/ui/textarea'
import { ArrowLeft } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import CopyLinkButton from '@/components/app/CopyLinkButton.vue'
import ErrorState from '@/components/app/ErrorState.vue'
import StatusTimeline from '@/components/viz/StatusTimeline.vue'
import TestStatusBadge from '@/components/viz/TestStatusBadge.vue'
import { useDemo, useProjectHistory } from '@/composables/queries'
import { useQuarantine } from '@/composables/useQuarantine'
import { formatDateTimeLong } from '@/lib/format'
import { testLabel } from '@/lib/test-display'

const props = defineProps<{ projectId: string }>()
const route = useRoute()
const isDemo = useDemo()
const { state, isLoading, error, execute: reloadHistory } = useProjectHistory(props.projectId)
const { byKey: quarantineByKey, savingKey, save, toggle, reload: reloadQuarantines } = useQuarantine(props.projectId)
// Quarantines fail with the same outage as the history, so a retry reloads both.
function retry() {
  void reloadHistory()
  void reloadQuarantines()
}
const savingQuarantine = computed(() => savingKey.value !== null)
const quarantineReason = ref('')

const testKey = computed(() => {
  const k = route.query.key
  return Array.isArray(k) ? (k[0] ?? '') : (k ?? '')
})

const project = computed(() => state.value.project)
const history = computed(() => state.value.histories.find(h => h.testKey === testKey.value))
const quarantine = computed(() => quarantineByKey.value.get(testKey.value))
const recent = computed(() => windowStats(history.value?.points ?? []))

// Clusters this test shares with at least one other test: "the same error hits N others".
const relatedClusters = computed(() =>
  state.value.clusters
    .filter(c => c.tests > 1 && c.testKeys.includes(testKey.value))
    .sort((a, b) => b.tests - a.tests),
)
const labels = computed(() => new Map(state.value.histories.map(h => [h.testKey, testLabel(h)])))

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
      <Skeleton class="h-28 rounded-xl" />
      <Skeleton class="h-64 rounded-xl" />
    </template>
    <div v-else-if="!history" class="text-sm text-muted-foreground">
      Test not found in history.
    </div>

    <template v-else>
      <!-- Header -->
      <div class="flex flex-col gap-6">
        <div class="flex items-start justify-between gap-4">
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
            <div v-if="history.codeOwners?.length" class="mt-2 flex flex-wrap gap-1.5">
              <Badge v-for="owner in history.codeOwners" :key="owner" class="border-signal/30 bg-signal/10 text-[10px] text-signal">
                {{ owner }}
              </Badge>
            </div>
          </div>
          <div class="flex shrink-0 items-center gap-2">
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

      <!-- Timeline -->
      <div class="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/80 px-6 py-5">
        <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>Status timeline</span>
          <span>{{ history.runs }} runs · oldest → newest</span>
        </div>
        <StatusTimeline :points="history.points" :project-id="projectId" :height="32" :q="history.title" />
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
        <RouterLink
          v-for="p in visibleIncidents"
          :key="p.runId"
          :to="{ name: 'run', params: { projectId, runId: p.runId }, query: { q: history.title } }"
          class="block rounded-lg border border-border/70 bg-card/80 px-4 py-3 transition-colors hover:border-border"
        >
          <div class="flex items-center justify-between gap-3">
            <div class="flex items-center gap-2">
              <TestStatusBadge :status="p.status" />
              <span class="font-mono text-xs text-muted-foreground">{{ formatDateTimeLong(p.startedAt) }}</span>
            </div>
            <span v-if="p.retries" class="font-mono text-[11px] text-flaky">{{ p.retries }} retry</span>
          </div>
          <pre v-if="p.errorMessage" class="mt-2 overflow-x-auto rounded-md bg-fail/5 p-3 font-mono text-[11px] leading-relaxed text-fail">{{ stripAnsi(p.errorMessage) }}</pre>
        </RouterLink>

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
