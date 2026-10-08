<script setup lang="ts">
import type { TestHistory, WindowStats } from '@kinora/core'
import { formatPct, HEALTH_WINDOW, RECENT_WINDOW, windowStats } from '@kinora/core'
import { Badge } from '@kinora/ui/badge'
import { Button } from '@kinora/ui/button'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@kinora/ui/pagination'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { StatBlock } from '@kinora/ui/stat-block'
import { ArrowLeft, ChevronLeft, ChevronRight } from '@lucide/vue'
import { useRouteQuery } from '@vueuse/router'
import { computed, watch } from 'vue'
import { RouterLink } from 'vue-router'
import CopyLinkButton from '@/components/app/CopyLinkButton.vue'
import SearchInput from '@/components/app/SearchInput.vue'
import FailureCausesCard from '@/components/project/FailureCausesCard.vue'
import StatusTimeline from '@/components/viz/StatusTimeline.vue'
import TestStatusBadge from '@/components/viz/TestStatusBadge.vue'
import { useProjectHistory } from '@/composables/queries'
import { useQuarantine } from '@/composables/useQuarantine'
import { testLabel } from '@/lib/test-display'

const props = defineProps<{ projectId: string }>()
const { state, isLoading, error } = useProjectHistory(props.projectId)
const { byKey: quarantineByKey, isQuarantined } = useQuarantine(props.projectId)

const project = computed(() => state.value.project)
const histories = computed(() => state.value.histories)
const clusters = computed(() => state.value.clusters)
const quarantinedCount = computed(() => quarantineByKey.value.size)

const search = useRouteQuery('q', '')
const unstableOnly = useRouteQuery<string, boolean>('unstable', 'true', {
  transform: {
    get: v => v !== 'false',
    set: v => (v ? 'true' : 'false'),
  },
})
const quarantinedOnly = useRouteQuery<string, boolean>('quarantined', 'false', {
  transform: {
    get: v => v === 'true',
    set: v => (v ? 'true' : 'false'),
  },
})

// Everything on this page reads the same window as the timeline: the last WINDOW runs. Rates, the
// "unstable" count/filter and the sort all derive from it, so the numbers match the bars.
const WINDOW = HEALTH_WINDOW

const statsByKey = computed(() => new Map(histories.value.map(h => [h.testKey, windowStats(h.points)])))
function stats(h: TestHistory): WindowStats {
  return statsByKey.value.get(h.testKey) ?? windowStats([])
}

const unstableCount = computed(() => histories.value.filter(h => stats(h).unstable).length)
const newlyFlakyCount = computed(() => histories.value.filter(h => h.newlyFlaky).length)
// "New failure" is gated on the test still failing now, so a recovered (green) test isn't badged broken.
const newlyBrokenCount = computed(() => histories.value.filter(h => h.newlyBroken && h.lastStatus === 'unexpected').length)

// Fresh breaks first (same gating as the badge), then by recent instability over the window.
function rank(h: TestHistory): number {
  if (h.newlyBroken && h.lastStatus === 'unexpected')
    return 2
  if (h.newlyFlaky)
    return 1
  return 0
}
const rows = computed(() => {
  const q = search.value.trim().toLowerCase()
  return histories.value
    .filter(h => (quarantinedOnly.value ? isQuarantined(h.testKey) : unstableOnly.value ? stats(h).unstable : true))
    .filter(
      h =>
        !q
        || h.titlePath.join(' ').toLowerCase().includes(q)
        || h.file.toLowerCase().includes(q),
    )
    .sort((a, b) => {
      const r = rank(b) - rank(a)
      if (r)
        return r
      return (stats(b).failRate * 2 + stats(b).flakyRate) - (stats(a).failRate * 2 + stats(a).flakyRate)
    })
})

const PAGE_SIZE = 25

// Page lives in the URL (?page=N) like the page's other view state; null = page 1 (clean URL).
const page = useRouteQuery<string | null>('page', null)
const pageCount = computed(() => Math.max(1, Math.ceil(rows.value.length / PAGE_SIZE)))
const pageIndex = computed(() => {
  const n = Math.floor(Number(page.value))
  if (!page.value || !Number.isFinite(n) || n < 1)
    return 0
  return Math.min(n - 1, pageCount.value - 1)
})
const currentPage = computed(() => pageIndex.value + 1)
const paged = computed(() => rows.value.slice(pageIndex.value * PAGE_SIZE, pageIndex.value * PAGE_SIZE + PAGE_SIZE))

// A changed filter should land on page 1, not a stale (clamped) page.
watch([search, unstableOnly, quarantinedOnly], () => {
  page.value = null
})

function showAllTests() {
  unstableOnly.value = false
  quarantinedOnly.value = false
}

function showUnstableTests() {
  unstableOnly.value = true
  quarantinedOnly.value = false
}

function showQuarantinedTests() {
  unstableOnly.value = false
  quarantinedOnly.value = true
}

function setPage(p: number) {
  page.value = p > 1 ? String(p) : null
}
</script>

<template>
  <div class="flex flex-col gap-8">
    <RouterLink
      :to="{ name: 'project', params: { projectId } }"
      class="flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-3.5" /> {{ project?.name ?? projectId }}
    </RouterLink>

    <div v-if="error" class="rounded-lg border border-fail/30 bg-fail/5 px-5 py-4 font-mono text-sm text-fail">
      {{ String(error) }}
    </div>
    <template v-else-if="isLoading">
      <Skeleton class="h-24 rounded-xl" />
      <Skeleton class="h-96 rounded-xl" />
    </template>

    <template v-else>
      <div class="flex flex-col gap-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight">
              Tests
            </h1>
            <p class="mt-1 text-sm text-muted-foreground">
              Per-test health over the last {{ WINDOW }} runs of {{ project?.name }}. 'New' = started failing or flaking in the last {{ RECENT_WINDOW }}.
            </p>
          </div>
          <CopyLinkButton class="shrink-0" />
        </div>

        <div class="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-lg border border-border/70 bg-card/80 px-6 py-5">
          <StatBlock label="Tests tracked" :value="histories.length" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Unstable" :value="unstableCount" :tone="unstableCount ? 'flaky' : 'pass'" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="New flakiness" :value="newlyFlakyCount" :tone="newlyFlakyCount ? 'flaky' : 'default'" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="New failures" :value="newlyBrokenCount" :tone="newlyBrokenCount ? 'fail' : 'default'" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Quarantined" :value="quarantinedCount" :tone="quarantinedCount ? 'flaky' : 'default'" />
        </div>
      </div>

      <FailureCausesCard :clusters="clusters" :histories="histories" :project-id="projectId" />

      <!-- Toolbar -->
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            class="font-mono text-xs"
            :class="!unstableOnly && !quarantinedOnly ? 'border-foreground/30 text-foreground' : ''"
            @click="showAllTests"
          >
            All tests
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="font-mono text-xs"
            :class="unstableOnly && !quarantinedOnly ? 'border-flaky/50 text-flaky hover:text-flaky' : ''"
            @click="showUnstableTests"
          >
            Unstable only
          </Button>
          <Button
            variant="outline"
            size="sm"
            class="font-mono text-xs"
            :class="quarantinedOnly ? 'border-flaky/50 text-flaky hover:text-flaky' : ''"
            @click="showQuarantinedTests"
          >
            Quarantined <span class="ml-1 tabular-nums text-muted-foreground">{{ quarantinedCount }}</span>
          </Button>
        </div>
        <SearchInput v-model="search" placeholder="Filter by title or file..." />
      </div>

      <!-- List -->
      <div class="flex flex-col gap-2">
        <RouterLink
          v-for="h in paged"
          :key="h.testKey"
          :to="{ name: 'test', params: { projectId }, query: { key: h.testKey } }"
          class="group grid grid-cols-[1fr_auto] items-center gap-4 rounded-lg border border-border/70 bg-card/80 px-4 py-3 transition-colors hover:border-border"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <TestStatusBadge :status="h.lastStatus" />
              <span class="truncate text-sm font-medium">{{ testLabel(h) }}</span>
              <Badge v-if="h.newlyBroken && h.lastStatus === 'unexpected'" class="border-fail/30 bg-fail/15 text-[10px] text-fail">
                New failure
              </Badge>
              <Badge v-else-if="h.newlyFlaky" class="border-flaky/30 bg-flaky/15 text-[10px] text-flaky">
                New flakiness
              </Badge>
              <Badge v-if="isQuarantined(h.testKey)" class="border-flaky/30 bg-flaky/10 text-[10px] text-flaky">
                Quarantined
              </Badge>
              <Badge v-for="owner in h.codeOwners" :key="owner" class="border-signal/30 bg-signal/10 text-[10px] text-signal">
                {{ owner }}
              </Badge>
            </div>
            <div class="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {{ h.file }} · {{ h.projectName }}
            </div>
          </div>

          <div class="flex items-center gap-6">
            <div class="hidden w-40 sm:block">
              <StatusTimeline :points="h.points" :project-id="projectId" :height="18" :link="false" :slots="WINDOW" />
            </div>
            <div class="w-14 text-right">
              <div class="font-mono text-sm tabular-nums" :class="stats(h).flakyRate ? 'text-flaky' : 'text-muted-foreground'">
                {{ formatPct(stats(h).flakyRate) }}
              </div>
              <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                flaky
              </div>
            </div>
            <div class="w-14 text-right">
              <div class="font-mono text-sm tabular-nums" :class="stats(h).failRate ? 'text-fail' : 'text-muted-foreground'">
                {{ formatPct(stats(h).failRate) }}
              </div>
              <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                fail
              </div>
            </div>
            <ChevronRight class="size-4 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
          </div>
        </RouterLink>

        <div v-if="!rows.length" class="py-12 text-center font-mono text-sm text-muted-foreground">
          {{ quarantinedOnly ? 'No quarantined tests.' : unstableOnly ? 'No unstable tests. All green.' : 'No tests match this filter.' }}
        </div>
      </div>

      <div v-if="rows.length > PAGE_SIZE" class="flex items-center justify-between gap-4">
        <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {{ rows.length }} tests
        </span>
        <Pagination
          :total="rows.length"
          :items-per-page="PAGE_SIZE"
          :page="currentPage"
          :sibling-count="1"
          show-edges
          class="mx-0 w-auto font-mono"
          @update:page="setPage"
        >
          <PaginationContent v-slot="{ items }" class="gap-0.5">
            <PaginationPrevious size="icon-sm" class="text-muted-foreground">
              <ChevronLeft class="size-3.5" />
            </PaginationPrevious>
            <template v-for="(item, i) in items" :key="i">
              <PaginationItem
                v-if="item.type === 'page'"
                :value="item.value"
                :is-active="item.value === currentPage"
                size="icon-sm"
                class="text-xs tabular-nums"
                :class="item.value === currentPage ? '' : 'text-muted-foreground'"
              >
                {{ item.value }}
              </PaginationItem>
              <PaginationEllipsis v-else :index="i" class="size-8 text-muted-foreground" />
            </template>
            <PaginationNext size="icon-sm" class="text-muted-foreground">
              <ChevronRight class="size-3.5" />
            </PaginationNext>
          </PaginationContent>
        </Pagination>
      </div>
    </template>
  </div>
</template>
