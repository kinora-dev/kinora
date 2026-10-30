<script setup lang="ts">
import type { IncidentRule, PwTestStatus, ScreenshotComparison } from '@kinora/core'
import { formatDuration, formatPct, partialRunLabel, passRate, runHealth, splitScreenshotComparisons, storiesOf, STORY_ANNOTATION, stripAnsi } from '@kinora/core'
import { Button } from '@kinora/ui/button'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { StatBlock } from '@kinora/ui/stat-block'
import { Tabs, TabsList, TabsTrigger } from '@kinora/ui/tabs'
import { ArrowLeft, Clock, ExternalLink, Film, GitBranch, GitCommitHorizontal, GitCompareArrows, Link2, Paperclip, ServerCrash } from '@lucide/vue'
import { useRouteQuery } from '@vueuse/router'
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { toast } from 'vue-sonner'
import A11yViolations from '@/components/a11y/A11yViolations.vue'
import CopyLinkButton from '@/components/app/CopyLinkButton.vue'
import ErrorState from '@/components/app/ErrorState.vue'
import ListPagination from '@/components/app/ListPagination.vue'
import SearchInput from '@/components/app/SearchInput.vue'
import StatStripSkeleton from '@/components/app/StatStripSkeleton.vue'
import FilterCombobox from '@/components/FilterCombobox.vue'
import RunHealthBadge from '@/components/viz/RunHealthBadge.vue'
import ScreenshotDiff from '@/components/viz/ScreenshotDiff.vue'
import StoryBadge from '@/components/viz/StoryBadge.vue'
import TestStatusBadge from '@/components/viz/TestStatusBadge.vue'
import { useDemo, useManifest, useRun } from '@/composables/queries'
import { usePaletteCommands } from '@/composables/useCommandPalette'
import { useQuarantine } from '@/composables/useQuarantine'
import { useUrlPage } from '@/composables/useUrlPage'
import { formatDateTimeLong } from '@/lib/format'
import { testLabel } from '@/lib/test-display'
import { isTraceAttachment, traceViewerHref } from '@/lib/trace'
import { trpc } from '@/lib/trpc'
import { commitUrl, httpsUrl } from '@/lib/url'

const props = defineProps<{ projectId: string, runId: string }>()

const isDemo = useDemo()
const { state: report, isLoading, error, execute: reloadRun } = useRun(props.projectId, props.runId)
const { state: manifest, execute: reloadManifest } = useManifest()
const { isQuarantined, savingKey: savingQuarantineKey, toggle: toggleQuarantine, reload: reloadQuarantines } = useQuarantine(props.projectId)
// The side queries fail with the same outage as the run, so a retry reloads them too.
function retry() {
  void reloadRun()
  void reloadManifest()
  void reloadQuarantines()
}

const projectName = computed(
  () => manifest.value?.projects.find(p => p.id === props.projectId)?.name ?? props.projectId,
)

// A run's pass rate is colored by the run's health, not its value: a run with real failures reads red.
// A run missing shards stays neutral, its counts cover part of the suite only.
const HEALTH_TONE = { passing: 'pass', flaky: 'flaky', failing: 'fail', empty: 'default' } as const
const runState = computed(() => report.value && { counts: report.value.counts, status: report.value.meta.status, shardProgress: report.value.meta.shardProgress, incident: report.value.meta.incident })
const partial = computed(() => runState.value && partialRunLabel(runState.value))
const incident = computed(() => report.value?.meta.incident)
const passTone = computed(() => (!runState.value || partial.value || incident.value ? 'default' : HEALTH_TONE[runHealth(runState.value.counts)]))

const INCIDENT_RULES: Record<IncidentRule, string> = {
  'host-unreachable': 'Detected: most failures could not reach the app',
  'browser-crash': 'Detected: most failures saw the browser crash or close',
  'manual': 'Marked by hand',
}
const incidentSource = computed(() => {
  const decision = report.value?.meta.incidentDecision
  if (decision?.flagged)
    return `Marked by ${decision.by} on ${formatDateTimeLong(decision.at)}`
  return incident.value && INCIDENT_RULES[incident.value.rule]
})
// A flag someone cleared stays visible, so the run counting again is not a surprise.
const incidentCleared = computed(() => {
  const decision = report.value?.meta.incidentDecision
  return decision && !decision.flagged ? decision : undefined
})

const savingIncident = ref(false)
async function setIncident(flagged: boolean) {
  if (!report.value)
    return
  savingIncident.value = true
  try {
    const state = await trpc.dashboard.setRunIncident.mutate({ projectId: props.projectId, runId: props.runId, flagged })
    // Assigned field by field: a cleared incident arrives as a missing key, which a spread would skip.
    report.value = { ...report.value, meta: { ...report.value.meta, incident: state.incident, incidentDecision: state.incidentDecision } }
    toast.success(flagged ? 'Run marked as an environment incident' : 'Incident flag cleared, the run counts again')
    void reloadManifest()
  }
  catch (err) {
    toast.error(err instanceof Error ? err.message : 'Could not update the run')
  }
  finally {
    savingIncident.value = false
  }
}

// The run just before this one (older startedAt) in the same project, for "Compare with previous".
const previousRunId = computed(() => {
  const proj = manifest.value?.projects.find(p => p.id === props.projectId)
  if (!proj)
    return undefined
  const sorted = [...proj.runs].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt))
  const idx = sorted.findIndex(r => r.runId === props.runId)
  return idx >= 0 && idx + 1 < sorted.length ? sorted[idx + 1].runId : undefined
})

const commitHref = computed(() => commitUrl(report.value?.meta.git))
const ciRunHref = computed(() => httpsUrl(report.value?.meta.ci?.runUrl))

async function copyLink() {
  await navigator.clipboard.writeText(window.location.href)
  toast.success('Link copied')
}

// The same links as the header and the first failure's trace pill, reachable from the keyboard.
usePaletteCommands(() => {
  const failure = report.value?.tests.find(t => t.status === 'unexpected' && traceViewerHref(t.attachments))
  const ci = report.value?.meta.ci
  const group = 'This run'
  return [
    ...(failure ? [{ id: 'run:trace', group, label: 'Open the trace of the first failure', detail: testLabel(failure), icon: Film, href: traceViewerHref(failure.attachments) }] : []),
    ...(previousRunId.value ? [{ id: 'run:compare', group, label: 'Compare with the previous run', keywords: 'diff', icon: GitCompareArrows, to: { name: 'compare', params: { projectId: props.projectId }, query: { base: previousRunId.value, head: props.runId } } }] : []),
    ...(ciRunHref.value ? [{ id: 'run:ci', group, label: `Open the ${ci?.provider ?? 'CI'} run`, keywords: 'ci pipeline workflow', hint: ci?.runNumber ? `#${ci.runNumber}` : undefined, icon: ExternalLink, href: ciRunHref.value }] : []),
    ...(commitHref.value ? [{ id: 'run:commit', group, label: 'Open the commit', hint: report.value?.meta.git?.sha?.slice(0, 7), icon: GitCommitHorizontal, href: commitHref.value }] : []),
    { id: 'run:copy-link', group, label: 'Copy the link to this run', keywords: 'share url', icon: Link2, run: copyLink },
  ]
})

const filter = useRouteQuery<'all' | PwTestStatus | 'quarantined'>('status', 'all')
const selectedTag = useRouteQuery('tag', 'all')
const search = useRouteQuery('q', '')
// One test of the run, by its key: where links about a given test land (its history page, the PR
// comment), exact where a title search could match several tests or projects.
const testKey = useRouteQuery<string | null>('test', null)

const tests = computed(() => report.value?.tests ?? [])
const tags = computed(() => [...new Set(tests.value.flatMap(t => t.tags))].sort())
const scoped = computed(() => (testKey.value ? tests.value.filter(t => t.testKey === testKey.value) : tests.value))

const tagMatched = computed(() => {
  if (selectedTag.value === 'all')
    return scoped.value
  return scoped.value.filter(t => t.tags.includes(selectedTag.value))
})

// Search-matched set, before the status tab. Tab counts derive from this so
// they track the tag/search filters; the tab itself only narrows the visible list.
const searchMatched = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q)
    return tagMatched.value
  return tagMatched.value.filter(
    t => t.titlePath.join(' ').toLowerCase().includes(q) || t.file.toLowerCase().includes(q),
  )
})

const tabCounts = computed(() => {
  const c = { all: searchMatched.value.length, unexpected: 0, flaky: 0, skipped: 0, quarantined: 0 }
  for (const t of searchMatched.value) {
    if (t.status === 'unexpected' || t.status === 'flaky' || t.status === 'skipped')
      c[t.status]++
    if (isQuarantined(t.testKey))
      c.quarantined++
  }
  return c
})

const filtered = computed(() => {
  if (filter.value === 'all')
    return searchMatched.value
  if (filter.value === 'quarantined')
    return searchMatched.value.filter(t => isQuarantined(t.testKey))
  return searchMatched.value.filter(t => t.status === filter.value)
})

// Paged: a run can carry tens of thousands of tests, and mounting a card per test froze the page
// (20,000 tests made ~240,000 DOM nodes). A changed filter lands on page 1.
const PAGE_SIZE = 50
const { pageIndex, currentPage, setPage } = useUrlPage(() => filtered.value.length, PAGE_SIZE)
const paged = computed(() => filtered.value.slice(pageIndex.value * PAGE_SIZE, (pageIndex.value + 1) * PAGE_SIZE))
watch([filter, selectedTag, search, testKey], () => setPage(1))

type Attachment = NonNullable<typeof report.value>['tests'][number]['attachments'][number]
type Annotation = NonNullable<typeof report.value>['tests'][number]['annotations'][number]

// Failed screenshot assertions whose images were uploaded: shown inline as a comparison.
// Without the upload there is nothing to display, and their images stay plain badges.
function screenshotDiffs(attachments: Attachment[]): ScreenshotComparison<Attachment>[] {
  return splitScreenshotComparisons(attachments).comparisons.filter(c => c.actual?.url)
}

// Playwright embeds screenshots and videos inside trace.zip, so a badge opens them in the
// viewer's attachments tab; their own `path` is a CI-runner path the server never received.
function attachmentBadges(attachments: Attachment[]): Attachment[] {
  const inline = new Set(screenshotDiffs(attachments).flatMap(c => [c.expected, c.actual, c.diff, c.previous]))
  const badges = attachments.filter(a => !inline.has(a) && !a.expired)
  return traceViewerHref(attachments) ? badges.filter(a => !isTraceAttachment(a)) : badges
}

// Files the server's artifact retention deleted: one badge for all of them, rather than dead ones.
function expiredLabel(attachments: Attachment[]): string | undefined {
  const expired = attachments.filter(a => a.expired)
  if (!expired.length)
    return undefined
  const others = expired.filter(a => !isTraceAttachment(a)).length
  const files = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`
  if (others === expired.length)
    return `${files(others)} expired`
  return others ? `Trace and ${files(others)} expired` : 'Trace expired'
}
function expiredTitle(attachments: Attachment[]): string {
  return `${attachments.filter(a => a.expired).map(a => a.name).join(', ')}: deleted by the artifact retention`
}

// An uploaded attachment links straight to its file; otherwise fall back to the trace viewer,
// which is where a traced run keeps its screenshots and video.
function attachmentHref(a: Attachment, attachments: Attachment[]): string | undefined {
  return a.url ?? traceViewerHref(attachments, 'attachments')
}

// Story annotations get their own linked badge (StoryBadge), so they're left out of the raw list.
function otherAnnotations(t: { annotations: Annotation[] }): Annotation[] {
  return t.annotations.filter(a => a.type !== STORY_ANNOTATION)
}

const BADGE_CLASS = 'inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground'
</script>

<template>
  <div class="flex flex-col gap-8">
    <RouterLink
      :to="{ name: 'project', params: { projectId } }"
      class="flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-3.5" /> {{ projectName }}
    </RouterLink>

    <ErrorState v-if="error" :error="error" @retry="retry()" />
    <template v-else-if="isLoading || !report">
      <div class="flex flex-col gap-6" aria-hidden="true">
        <div class="flex items-start justify-between gap-4">
          <div class="flex flex-col gap-1">
            <Skeleton class="my-1 h-5 w-56" />
            <Skeleton class="h-4 w-48" />
          </div>
          <Skeleton class="h-8 w-48" />
        </div>
        <StatStripSkeleton :count="6" />
      </div>
      <div class="flex items-center justify-between gap-3" aria-hidden="true">
        <Skeleton class="h-9 w-[28rem] max-w-full" />
        <Skeleton class="h-9 w-72" />
      </div>
      <div class="flex flex-col gap-2" aria-hidden="true">
        <Skeleton v-for="i in 6" :key="i" class="h-[86px] rounded-lg" />
      </div>
    </template>

    <template v-else>
      <!-- Header -->
      <div class="flex flex-col gap-6">
        <div class="flex flex-col items-start gap-4 sm:flex-row sm:justify-between">
          <div>
            <div class="flex flex-wrap items-center gap-3">
              <h1 class="text-xl font-semibold tracking-tight">
                {{ formatDateTimeLong(report.startedAt) }}
              </h1>
              <RunHealthBadge v-if="runState && (partial || incident)" :run="runState" />
            </div>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
              <span v-if="report.meta.git?.branch" class="flex items-center gap-1 whitespace-nowrap">
                <GitBranch class="size-3" />{{ report.meta.git.branch }}
                <template v-if="report.meta.git.sha">
                  @ <a
                    v-if="commitHref"
                    :href="commitHref"
                    target="_blank"
                    rel="noreferrer"
                    class="hover:text-foreground hover:underline"
                  >{{ report.meta.git.sha.slice(0, 7) }}</a>
                  <span v-else>{{ report.meta.git.sha.slice(0, 7) }}</span>
                </template>
              </span>
              <span v-if="report.meta.playwrightVersion" class="whitespace-nowrap">playwright {{ report.meta.playwrightVersion }}</span>
              <span v-if="incidentCleared" class="whitespace-nowrap">incident flag cleared by {{ incidentCleared.by }}</span>
            </div>
          </div>

          <div class="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              v-if="!incident && report.counts.unexpected > 0 && !isDemo"
              variant="outline"
              size="sm"
              class="font-mono text-xs text-muted-foreground"
              title="The failures come from the environment under test: leave this run out of histories, baselines and alerts"
              :disabled="savingIncident"
              @click="setIncident(true)"
            >
              <ServerCrash class="size-3.5" />
              Mark as incident
            </Button>
            <Button
              v-if="previousRunId"
              as-child
              variant="outline"
              size="sm"
              class="font-mono text-xs text-muted-foreground"
            >
              <RouterLink :to="{ name: 'compare', params: { projectId }, query: { base: previousRunId, head: runId } }">
                <GitCompareArrows class="size-3.5" />
                Compare
              </RouterLink>
            </Button>
            <Button
              v-if="ciRunHref"
              as-child
              variant="outline"
              size="sm"
              class="font-mono text-xs text-muted-foreground"
            >
              <a :href="ciRunHref" target="_blank" rel="noreferrer">
                <ExternalLink class="size-3.5" />
                {{ report.meta.ci?.provider ?? 'CI' }}<span v-if="report.meta.ci?.runNumber"> #{{ report.meta.ci.runNumber }}</span>
              </a>
            </Button>
            <CopyLinkButton />
          </div>
        </div>

        <div
          v-if="incident"
          role="status"
          class="flex flex-col items-start gap-3 rounded-lg border border-border/70 bg-card/80 px-6 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <div class="flex items-start gap-3">
            <ServerCrash class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
            <div class="flex flex-col gap-1">
              <p class="text-sm font-medium">
                Environment incident · not counted
              </p>
              <p class="text-sm text-muted-foreground">
                {{ incident.reason }} This run is left out of test histories, flaky scores, baselines and regression alerts.
              </p>
              <p class="font-mono text-xs text-muted-foreground">
                {{ incidentSource }}
              </p>
            </div>
          </div>
          <Button
            v-if="!isDemo"
            variant="outline"
            size="sm"
            class="shrink-0 font-mono text-xs text-muted-foreground"
            :disabled="savingIncident"
            @click="setIncident(false)"
          >
            Clear the flag
          </Button>
        </div>

        <div class="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-lg border border-border/70 bg-card/80 px-6 py-5">
          <StatBlock
            label="Pass rate" :value="formatPct(passRate(report.counts))"
            :tone="passTone"
          />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Total" :value="report.counts.total" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Failed" :value="report.counts.unexpected" :tone="report.counts.unexpected ? 'fail' : 'default'" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Flaky" :value="report.counts.flaky" :tone="report.counts.flaky ? 'flaky' : 'default'" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Skipped" :value="report.counts.skipped" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Duration" :value="formatDuration(report.duration)" />
        </div>
      </div>

      <!-- Filters -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <Tabs v-model="filter" class="w-full max-w-full overflow-x-auto sm:w-auto">
          <TabsList class="min-w-max font-mono">
            <TabsTrigger value="all">
              All <span class="ml-1.5 tabular-nums text-muted-foreground">{{ tabCounts.all }}</span>
            </TabsTrigger>
            <TabsTrigger value="unexpected" class="data-[state=active]:text-fail">
              Failed <span class="ml-1.5 tabular-nums text-muted-foreground">{{ tabCounts.unexpected }}</span>
            </TabsTrigger>
            <TabsTrigger value="flaky" class="data-[state=active]:text-flaky">
              Flaky <span class="ml-1.5 tabular-nums text-muted-foreground">{{ tabCounts.flaky }}</span>
            </TabsTrigger>
            <TabsTrigger value="skipped">
              Skipped <span class="ml-1.5 tabular-nums text-muted-foreground">{{ tabCounts.skipped }}</span>
            </TabsTrigger>
            <TabsTrigger value="quarantined" class="data-[state=active]:text-flaky">
              Quarantined <span class="ml-1.5 tabular-nums text-muted-foreground">{{ tabCounts.quarantined }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <FilterCombobox
            v-if="tags.length > 1"
            v-model="selectedTag"
            :options="tags"
            all-label="All tags"
            search-placeholder="Search tag..."
            trigger-class="w-40"
          />
          <SearchInput v-model="search" placeholder="Filter by title or file..." />
        </div>
      </div>

      <div
        v-if="testKey"
        class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-signal/30 bg-signal/5 px-4 py-2.5 text-sm"
        data-testid="single-test"
      >
        <span>{{ scoped.length ? 'Showing one test of this run.' : 'This test is not in this run.' }}</span>
        <Button variant="ghost" size="sm" class="h-7 font-mono text-xs" @click="testKey = null">
          Show all tests
        </Button>
      </div>

      <!-- Tests -->
      <div class="flex flex-col gap-2">
        <div
          v-for="t in paged"
          :key="t.testKey"
          class="rounded-lg border border-border/70 bg-card/80 px-4 py-3 transition-colors hover:border-border"
        >
          <div class="flex items-start justify-between gap-4">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <TestStatusBadge :status="t.status" />
                <span
                  v-for="tag in t.tags"
                  :key="tag"
                  class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >{{ tag }}</span>
                <span
                  v-if="isQuarantined(t.testKey)"
                  class="rounded border border-flaky/30 bg-flaky/10 px-1.5 py-0.5 font-mono text-[10px] text-flaky"
                >Quarantined</span>
                <span
                  v-for="owner in t.codeOwners"
                  :key="owner"
                  class="rounded border border-signal/30 bg-signal/10 px-1.5 py-0.5 font-mono text-[10px] text-signal"
                >{{ owner }}</span>
                <StoryBadge v-for="id in storiesOf(t)" :key="id" :project-id="projectId" :story-id="id" />
                <span
                  v-for="(a, i) in otherAnnotations(t)"
                  :key="`${a.type}-${i}`"
                  :title="a.description"
                  class="inline-flex max-w-xs items-center gap-1 truncate rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground"
                >
                  {{ a.type }}<span v-if="a.description" class="text-muted-foreground/70">: {{ a.description }}</span>
                </span>
              </div>
              <RouterLink
                :to="{ name: 'test', params: { projectId }, query: { key: t.testKey } }"
                class="mt-1.5 block truncate text-sm font-medium hover:underline"
              >
                {{ testLabel(t) }}
              </RouterLink>
              <div class="mt-0.5 font-mono text-[11px] text-muted-foreground">
                {{ t.file }}:{{ t.line }} &middot; {{ t.projectName }}
              </div>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-2">
              <div class="text-right font-mono text-[11px] text-muted-foreground">
                <div class="tabular-nums">
                  {{ formatDuration(t.duration) }}
                </div>
                <div v-if="t.retries" class="tabular-nums text-flaky">
                  {{ t.retries }} retry
                </div>
              </div>
              <Button
                variant="outline"
                size="sm"
                class="h-7 font-mono text-[11px] text-muted-foreground"
                :disabled="isDemo || savingQuarantineKey === t.testKey"
                @click="toggleQuarantine(t.testKey)"
              >
                {{ isQuarantined(t.testKey) ? 'Unquarantine' : 'Quarantine' }}
              </Button>
            </div>
          </div>

          <!-- Error + attachments -->
          <div v-if="t.errors.length" class="mt-3 overflow-x-auto rounded-md bg-fail/5 p-3">
            <pre class="font-mono text-[11px] leading-relaxed text-fail">{{ stripAnsi(t.errors[0].message) }}</pre>
          </div>
          <!-- A passed a11y check says nothing worth the space on a run. -->
          <A11yViolations v-if="t.a11y && t.a11y.status !== 'passed'" :report="t.a11y" class="mt-3" />
          <div v-if="screenshotDiffs(t.attachments).length" class="mt-3 flex flex-col gap-3">
            <ScreenshotDiff v-for="(c, i) in screenshotDiffs(t.attachments)" :key="`${c.name}-${i}`" :comparison="c" />
          </div>
          <div v-if="t.attachments.length" class="mt-2 flex flex-wrap items-center gap-1.5">
            <a
              v-if="traceViewerHref(t.attachments)"
              :href="traceViewerHref(t.attachments)"
              target="_blank"
              rel="noopener"
              data-umami-event="view-trace"
              class="inline-flex items-center gap-1 rounded border border-signal/40 bg-signal/10 px-2 py-0.5 text-[11px] font-medium text-signal transition-colors hover:bg-signal/20"
            >
              <Film class="size-3" />View trace
            </a>
            <template v-for="(a, i) in attachmentBadges(t.attachments)" :key="`${a.name}-${i}`">
              <a
                v-if="attachmentHref(a, t.attachments)"
                :href="attachmentHref(a, t.attachments)"
                target="_blank"
                rel="noopener"
                class="transition-colors hover:border-signal/40 hover:text-signal" :class="BADGE_CLASS"
              >
                <Paperclip class="size-3" />{{ a.name }}
              </a>
              <span v-else :class="BADGE_CLASS">
                <Paperclip class="size-3" />{{ a.name }}
              </span>
            </template>
            <span v-if="expiredLabel(t.attachments)" :class="BADGE_CLASS" :title="expiredTitle(t.attachments)" data-testid="expired-artifacts">
              <Clock class="size-3" />{{ expiredLabel(t.attachments) }}
            </span>
          </div>
        </div>

        <div v-if="!filtered.length" class="py-12 text-center font-mono text-sm text-muted-foreground">
          No tests match this filter.
        </div>
      </div>

      <ListPagination :total="filtered.length" :page-size="PAGE_SIZE" :page="currentPage" noun="tests" @update:page="setPage" />
    </template>
  </div>
</template>
