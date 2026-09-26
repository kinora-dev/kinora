<script setup lang="ts">
import type { PwTestStatus } from '@kinora/core'
import { formatDuration, formatPct, passRate, runHealth, stripAnsi } from '@kinora/core'
import { Button } from '@kinora/ui/button'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { StatBlock } from '@kinora/ui/stat-block'
import { Tabs, TabsList, TabsTrigger } from '@kinora/ui/tabs'
import { ArrowLeft, ExternalLink, Film, GitBranch, GitCompareArrows, Paperclip } from '@lucide/vue'
import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import CopyLinkButton from '@/components/app/CopyLinkButton.vue'
import FilterCombobox from '@/components/FilterCombobox.vue'
import SearchInput from '@/components/app/SearchInput.vue'
import TestStatusBadge from '@/components/viz/TestStatusBadge.vue'
import { useManifest, useRun } from '@/composables/queries'
import { testLabel } from '@/lib/test-display'
import { isTraceAttachment, traceViewerHref } from '@/lib/trace'
import { httpsUrl } from '@/lib/url'

const props = defineProps<{ projectId: string, runId: string }>()

const { state: report, isLoading, error } = useRun(props.projectId, props.runId)
const { state: manifest } = useManifest()

const projectName = computed(
  () => manifest.value?.projects.find(p => p.id === props.projectId)?.name ?? props.projectId,
)

// A run's pass rate is colored by the run's health, not its value: a run with real failures reads red.
const HEALTH_TONE = { passing: 'pass', flaky: 'flaky', failing: 'fail', empty: 'default' } as const
const passTone = computed(() => (report.value ? HEALTH_TONE[runHealth(report.value.counts)] : 'default'))

// The run just before this one (older startedAt) in the same project, for "Compare with previous".
const previousRunId = computed(() => {
  const proj = manifest.value?.projects.find(p => p.id === props.projectId)
  if (!proj)
    return undefined
  const sorted = [...proj.runs].sort((a, b) => +new Date(b.startedAt) - +new Date(a.startedAt))
  const idx = sorted.findIndex(r => r.runId === props.runId)
  return idx >= 0 && idx + 1 < sorted.length ? sorted[idx + 1].runId : undefined
})

// Link a sha to its commit. github/gitlab use /commit/, bitbucket /commits/.
// repoUrl is only trusted as an href if it's https; a bad value yields no link (guards stored XSS).
const commitHref = computed(() => {
  const g = report.value?.meta.git
  const url = httpsUrl(g?.repoUrl)
  if (!url || !g?.sha)
    return undefined
  const base = url.replace(/\/$/, '')

  const seg = new URL(url).hostname === 'bitbucket.org' ? 'commits' : 'commit'
  return `${base}/${seg}/${g.sha}`
})
const ciRunHref = computed(() => httpsUrl(report.value?.meta.ci?.runUrl))

const filter = useRouteQuery<'all' | PwTestStatus>('status', 'all')
const tag = useRouteQuery('tag', 'all')
const search = useRouteQuery('q', '')

const tests = computed(() => report.value?.tests ?? [])
const tags = computed(() => [...new Set(tests.value.flatMap(t => t.tags))].sort())

const tagMatched = computed(() => {
  if (tag.value === 'all')
    return tests.value
  return tests.value.filter(t => t.tags.includes(tag.value))
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
  const c = { all: searchMatched.value.length, unexpected: 0, flaky: 0, skipped: 0 }
  for (const t of searchMatched.value) {
    if (t.status === 'unexpected' || t.status === 'flaky' || t.status === 'skipped')
      c[t.status]++
  }
  return c
})

const filtered = computed(() =>
  filter.value === 'all'
    ? searchMatched.value
    : searchMatched.value.filter(t => t.status === filter.value),
)

type Attachment = NonNullable<typeof report.value>['tests'][number]['attachments'][number]

// Playwright embeds screenshots and videos inside trace.zip, so a badge opens them in the
// viewer's attachments tab; their own `path` is a CI-runner path the server never received.
function attachmentBadges(attachments: Attachment[]): Attachment[] {
  return traceViewerHref(attachments) ? attachments.filter(a => !isTraceAttachment(a)) : attachments
}

// An uploaded attachment links straight to its file; otherwise fall back to the trace viewer,
// which is where a traced run keeps its screenshots and video.
function attachmentHref(a: Attachment, attachments: Attachment[]): string | undefined {
  return a.url ?? traceViewerHref(attachments, 'attachments')
}

const BADGE_CLASS = 'inline-flex items-center gap-1 rounded border border-border px-2 py-0.5 font-mono text-[10px] text-muted-foreground'

const dateFmt = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})
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
    <template v-else-if="isLoading || !report">
      <Skeleton class="h-28 rounded-xl" />
      <Skeleton class="h-96 rounded-xl" />
    </template>

    <template v-else>
      <!-- Header -->
      <div class="flex flex-col gap-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-xl font-semibold tracking-tight">
              {{ dateFmt.format(new Date(report.startedAt)) }}
            </h1>
            <div class="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-muted-foreground">
              <span v-if="report.meta.git?.branch" class="flex items-center gap-1">
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
              <span v-if="report.meta.playwrightVersion">playwright {{ report.meta.playwrightVersion }}</span>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
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
        <Tabs v-model="filter">
          <TabsList class="font-mono">
            <TabsTrigger value="all">
              All <span class="ml-1.5 tabular-nums text-muted-foreground">{{ tabCounts.all }}</span>
            </TabsTrigger>
            <TabsTrigger value="unexpected" class="data-[state=active]:text-fail">
              Failing <span class="ml-1.5 tabular-nums text-muted-foreground">{{ tabCounts.unexpected }}</span>
            </TabsTrigger>
            <TabsTrigger value="flaky" class="data-[state=active]:text-flaky">
              Flaky <span class="ml-1.5 tabular-nums text-muted-foreground">{{ tabCounts.flaky }}</span>
            </TabsTrigger>
            <TabsTrigger value="skipped">
              Skipped <span class="ml-1.5 tabular-nums text-muted-foreground">{{ tabCounts.skipped }}</span>
            </TabsTrigger>
          </TabsList>
        </Tabs>
        <div class="flex flex-wrap items-center justify-end gap-2">
          <FilterCombobox
            v-if="tags.length > 1"
            v-model="tag"
            :options="tags"
            all-label="All tags"
            search-placeholder="Search tag..."
            trigger-class="w-40"
          />
          <SearchInput v-model="search" placeholder="Filter by title or file..." />
        </div>
      </div>

      <!-- Tests -->
      <div class="flex flex-col gap-2">
        <div
          v-for="t in filtered"
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
                  v-for="(a, i) in t.annotations"
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
            <div class="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
              <div class="tabular-nums">
                {{ formatDuration(t.duration) }}
              </div>
              <div v-if="t.retries" class="tabular-nums text-flaky">
                {{ t.retries }} retry
              </div>
            </div>
          </div>

          <!-- Error + attachments -->
          <div v-if="t.errors.length" class="mt-3 overflow-x-auto rounded-md bg-fail/5 p-3">
            <pre class="font-mono text-[11px] leading-relaxed text-fail">{{ stripAnsi(t.errors[0].message) }}</pre>
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
          </div>
        </div>

        <div v-if="!filtered.length" class="py-12 text-center font-mono text-sm text-muted-foreground">
          No tests match this filter.
        </div>
      </div>
    </template>
  </div>
</template>
