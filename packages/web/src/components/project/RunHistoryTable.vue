<script setup lang="ts">
import type { RunHealth, RunSummary } from '@kinora/core'
import type { ColumnDef, SortingState } from '@tanstack/vue-table'
import { formatDuration, formatPct, passRate, runHealth } from '@kinora/core'
import { HealthBadge } from '@kinora/ui/health-badge'
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationNext,
  PaginationPrevious,
} from '@kinora/ui/pagination'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kinora/ui/table'
import { valueUpdater } from '@kinora/ui/table/utils'
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from '@lucide/vue'
import { getCoreRowModel, getPaginationRowModel, getSortedRowModel, useVueTable } from '@tanstack/vue-table'
import { useRouteQuery } from '@vueuse/router'
import { computed, ref } from 'vue'
import { useRouter } from 'vue-router'
import { formatDateTime } from '@/lib/format'

const props = defineProps<{ runs: RunSummary[], projectId: string }>()

const router = useRouter()

// Worst-first ordering when sorting health descending.
const HEALTH_RANK: Record<RunHealth, number> = { failing: 3, flaky: 2, passing: 1, empty: 0 }

const columns: ColumnDef<RunSummary>[] = [
  { id: 'run', accessorFn: r => r.startedAt }, // ISO string sorts chronologically
  { id: 'health', accessorFn: r => HEALTH_RANK[runHealth(r.counts)] },
  { id: 'pass', accessorFn: r => passRate(r.counts) },
  { id: 'fail', accessorFn: r => r.counts.unexpected },
  { id: 'flaky', accessorFn: r => r.counts.flaky },
  { id: 'duration', accessorFn: r => r.duration },
  { id: 'sha', accessorFn: r => r.git?.sha ?? '', enableSorting: false },
]

const headerCols = [
  { id: 'run', label: 'Run', right: false },
  { id: 'health', label: 'Health', right: false },
  { id: 'pass', label: 'Pass', right: true },
  { id: 'fail', label: 'Fail', right: true },
  { id: 'flaky', label: 'Flaky', right: true },
  { id: 'duration', label: 'Duration', right: true },
  { id: 'sha', label: 'SHA', right: true },
] as const

const sorting = ref<SortingState>([{ id: 'run', desc: true }])

const PAGE_SIZE = 25

// Page lives in the URL (?page=N) like the app's other view state; null = page 1 (clean URL).
const page = useRouteQuery<string | null>('page', null)
const totalRuns = computed(() => props.runs.length)
const pageCount = computed(() => Math.max(1, Math.ceil(totalRuns.value / PAGE_SIZE)))
const pageIndex = computed(() => {
  const n = Math.floor(Number(page.value))
  if (!page.value || !Number.isFinite(n) || n < 1)
    return 0
  return Math.min(n - 1, pageCount.value - 1)
})
const currentPage = computed(() => pageIndex.value + 1)

const table = useVueTable({
  get data() { return props.runs },
  columns,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  getPaginationRowModel: getPaginationRowModel(),
  onSortingChange: updaterOrValue => valueUpdater(updaterOrValue, sorting),
  onPaginationChange: (updater) => {
    const next = typeof updater === 'function' ? updater({ pageIndex: pageIndex.value, pageSize: PAGE_SIZE }) : updater
    page.value = next.pageIndex > 0 ? String(next.pageIndex + 1) : null
  },
  // URL is the source of truth for the page; don't let async data arrival reset a deep-linked page.
  autoResetPageIndex: false,
  state: {
    get sorting() { return sorting.value },
    get pagination() { return { pageIndex: pageIndex.value, pageSize: PAGE_SIZE } },
  },
})

function sortDir(id: string) {
  return table.getColumn(id)?.getIsSorted()
}
</script>

<template>
  <div class="rounded-xl border border-border/70 bg-card/80 overflow-hidden">
    <Table>
      <TableHeader>
        <TableRow class="hover:bg-transparent">
          <TableHead
            v-for="col in headerCols"
            :key="col.id"
            class="font-mono text-[10px] uppercase tracking-wider"
            :class="col.right ? 'text-right' : ''"
          >
            <button
              v-if="table.getColumn(col.id)?.getCanSort()"
              type="button"
              class="inline-flex items-center gap-1 uppercase tracking-wider hover:text-foreground"
              @click="table.getColumn(col.id)?.toggleSorting()"
            >
              {{ col.label }}
              <ArrowUp v-if="sortDir(col.id) === 'asc'" class="size-3" />
              <ArrowDown v-else-if="sortDir(col.id) === 'desc'" class="size-3" />
              <ChevronsUpDown v-else class="size-3 opacity-40" />
            </button>
            <span v-else>{{ col.label }}</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="row in table.getRowModel().rows"
          :key="row.original.runId"
          class="cursor-pointer"
          @click="router.push({ name: 'run', params: { projectId, runId: row.original.runId } })"
        >
          <TableCell class="font-mono text-xs">
            {{ formatDateTime(row.original.startedAt) }}
          </TableCell>
          <TableCell><HealthBadge :health="runHealth(row.original.counts)" /></TableCell>
          <TableCell class="text-right font-mono text-xs tabular-nums">
            {{ formatPct(passRate(row.original.counts)) }}
          </TableCell>
          <TableCell class="text-right font-mono text-xs tabular-nums" :class="row.original.counts.unexpected ? 'text-fail' : 'text-muted-foreground'">
            {{ row.original.counts.unexpected }}
          </TableCell>
          <TableCell class="text-right font-mono text-xs tabular-nums" :class="row.original.counts.flaky ? 'text-flaky' : 'text-muted-foreground'">
            {{ row.original.counts.flaky }}
          </TableCell>
          <TableCell class="text-right font-mono text-xs tabular-nums text-muted-foreground">
            {{ formatDuration(row.original.duration) }}
          </TableCell>
          <TableCell class="text-right font-mono text-xs text-muted-foreground">
            {{ row.original.git?.sha ? row.original.git.sha.slice(0, 7) : '-' }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <div
      v-if="totalRuns > PAGE_SIZE"
      class="flex items-center justify-between gap-4 border-t border-border/70 px-4 py-3"
    >
      <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {{ totalRuns }} runs
      </span>
      <Pagination
        :total="totalRuns"
        :items-per-page="PAGE_SIZE"
        :page="currentPage"
        :sibling-count="1"
        show-edges
        class="mx-0 w-auto font-mono"
        @update:page="(p: number) => table.setPageIndex(p - 1)"
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
  </div>
</template>
