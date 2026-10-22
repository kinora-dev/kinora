<script setup lang="ts">
import type { RunHealth, RunSummary } from '@kinora/core'
import type { ColumnDef, SortingState } from '@tanstack/vue-table'
import { formatDuration, formatPct, partialRunLabel, passRate, runHealth } from '@kinora/core'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kinora/ui/table'
import { ArrowDown, ArrowUp, ChevronsUpDown } from '@lucide/vue'
import {
  createPaginatedRowModel,
  createSortedRowModel,
  rowPaginationFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  tableFeatures,
  useTable,
} from '@tanstack/vue-table'
import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import ListPagination from '@/components/app/ListPagination.vue'
import RunHealthBadge from '@/components/viz/RunHealthBadge.vue'
import { useUrlPage } from '@/composables/useUrlPage'
import { formatDateTime } from '@/lib/format'

const props = defineProps<{ runs: RunSummary[], projectId: string }>()

const router = useRouter()

// Worst-first ordering when sorting health descending; a run missing shards ranks with failures.
const HEALTH_RANK: Record<RunHealth | 'partial', number> = { failing: 3, partial: 3, flaky: 2, passing: 1, empty: 0 }

const features = tableFeatures({
  rowSortingFeature,
  rowPaginationFeature,
  sortedRowModel: createSortedRowModel(),
  paginatedRowModel: createPaginatedRowModel(),
  sortFns: { basic: sortFn_basic, alphanumeric: sortFn_alphanumeric },
})

const columns: ColumnDef<typeof features, RunSummary>[] = [
  { id: 'run', accessorFn: r => r.startedAt }, // ISO string sorts chronologically
  { id: 'health', accessorFn: r => HEALTH_RANK[partialRunLabel(r) ? 'partial' : runHealth(r.counts)] },
  { id: 'pass', accessorFn: r => passRate(r.counts) },
  { id: 'fail', accessorFn: r => r.counts.unexpected },
  { id: 'flaky', accessorFn: r => r.counts.flaky },
  { id: 'duration', accessorFn: r => r.duration },
  { id: 'sha', accessorFn: r => r.git?.sha ?? '', enableSorting: false },
]

const headerCols = [
  { id: 'run', label: 'Run', right: false },
  { id: 'health', label: 'Health', right: false },
  { id: 'pass', label: 'Pass rate', right: true },
  { id: 'fail', label: 'Failed', right: true },
  { id: 'flaky', label: 'Flaky', right: true },
  { id: 'duration', label: 'Duration', right: true },
  { id: 'sha', label: 'SHA', right: true },
] as const

const SORTABLE = new Set(columns.filter(c => c.enableSorting !== false).map(c => c.id))

// Sort lives in the URL next to the page (?sort=health&dir=asc): a page number only means
// something under a given order, so a shared link must carry both. null = newest first, desc.
const sortQuery = useRouteQuery<string | null>('sort', null)
const dirQuery = useRouteQuery<string | null>('dir', null)
const sorting = computed<SortingState>(() => [{
  id: sortQuery.value && SORTABLE.has(sortQuery.value) ? sortQuery.value : 'run',
  desc: dirQuery.value !== 'asc',
}])

const PAGE_SIZE = 25

const { pageIndex, currentPage, setPage } = useUrlPage(() => props.runs.length, PAGE_SIZE)

const state = computed(() => ({
  sorting: sorting.value,
  pagination: { pageIndex: pageIndex.value, pageSize: PAGE_SIZE },
}))

const table = useTable({
  features,
  get data() { return props.runs },
  columns,
  onSortingChange: (updater) => {
    const [next] = typeof updater === 'function' ? updater(sorting.value) : updater
    if (!next)
      return
    sortQuery.value = next.id === 'run' ? null : next.id
    dirQuery.value = next.desc ? null : 'asc'
    // A new order should land on page 1, not mid-list of an unrelated ranking.
    setPage(1)
  },
  // Always sorted: the default (run desc) has no "unsorted" state to toggle back to.
  enableSortingRemoval: false,
  onPaginationChange: (updater) => {
    const next = typeof updater === 'function' ? updater({ pageIndex: pageIndex.value, pageSize: PAGE_SIZE }) : updater
    setPage(next.pageIndex + 1)
  },
  // URL is the source of truth for the page; don't let async data arrival reset a deep-linked page.
  autoResetPageIndex: false,
  state,
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
          <TableCell><RunHealthBadge :run="row.original" /></TableCell>
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

    <ListPagination
      :total="runs.length"
      :page-size="PAGE_SIZE"
      :page="currentPage"
      noun="runs"
      class="border-t border-border/70 px-4 py-3"
      @update:page="(p: number) => table.setPageIndex(p - 1)"
    />
  </div>
</template>
