<script setup lang="ts">
import type { ColumnDef, SortingState } from '@tanstack/vue-table'
import type { NetworkMatch, NetworkRow, ResourceCategory } from '../lib/network'
import { cn } from '@kinora/ui'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@kinora/ui/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@kinora/ui/resizable'
import { valueUpdater } from '@kinora/ui/table/utils'
import { ChevronDown, ChevronUp, ListFilter } from '@lucide/vue'
import {
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_basic,
  sortFn_text,
  tableFeatures,
  useTable,
} from '@tanstack/vue-table'
import { useElementSize, useStorage } from '@vueuse/core'
import { computed, nextTick, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { formatMs } from '../lib/format'
import { bodyUrl, CANCELED_STATUS, formatSize, NETWORK_SEARCH_FIELDS, networkMatches, RESOURCE_CATEGORIES, SEARCH_BODY_LIMIT, searchableRequestFile, searchableResponseFile, statusClass, statusLabel } from '../lib/network'
import { useTraceStore } from '../store'
import FilterInput from './FilterInput.vue'
import NetworkDetails from './NetworkDetails.vue'
import TextTooltip from './TextTooltip.vue'

const store = useTraceStore()
// A hovered row leaves no mouseleave behind when the tab closes under the pointer.
onBeforeUnmount(() => store.setHighlightedTime(null))

// Persisted [table, detail] widths (percentages); applied only while a row is selected.
const netCols = useStorage('kinora-tv-net-cols', [62, 38])
const netRows = useStorage('kinora-tv-net-rows', [45, 55])

// Too narrow for the table and the details side by side (e.g. details docked right): stack them.
const root = ref<HTMLElement | null>(null)
const { width: rootWidth } = useElementSize(root)
const stacked = computed(() => rootWidth.value > 0 && rootWidth.value < 720)
const split = computed(() => stacked.value ? netRows.value : netCols.value)

const search = ref('')
const activeCats = ref<Set<ResourceCategory>>(new Set())
const sorting = ref<SortingState>([])
const selectedId = ref<string | null>(null)
const scope = store.networkScope
const searchIn = useStorage<NetworkMatch[]>('kinora-tv-net-search-in', NETWORK_SEARCH_FIELDS.map(f => f.field))
const searchesBodies = computed(() => searchIn.value.includes('request body') || searchIn.value.includes('response body'))
const query = computed(() => search.value.trim().toLowerCase())

function setSearchIn(field: NetworkMatch, checked: boolean): void {
  const rest = searchIn.value.filter(f => f !== field)
  searchIn.value = checked ? [...rest, field] : rest
}

const searchPlaceholder = computed(() => {
  const labels = NETWORK_SEARCH_FIELDS.filter(f => searchIn.value.includes(f.field)).map(f => f.label.toLowerCase())
  if (!labels.length)
    return 'Pick where to search'
  return labels.length === NETWORK_SEARCH_FIELDS.length ? 'Search URLs, headers, bodies' : `Search ${labels.join(', ')}`
})

const responseTexts = shallowRef(new Map<string, string>())
const requestTexts = shallowRef(new Map<string, string>())
const loadingBodies = ref(false)
let bodiesLoadedFor: unknown = null

async function loadResponseTexts(): Promise<void> {
  const m = store.model.value
  if (!m || bodiesLoadedFor === m)
    return
  bodiesLoadedFor = m
  loadingBodies.value = true
  const responses = new Map<string, string>()
  const requests = new Map<string, string>()
  const pending = m.resources.flatMap((r) => {
    const jobs: { id: string, url: string, into: Map<string, string> }[] = []
    const responseFile = searchableResponseFile(r)
    const requestFile = searchableRequestFile(r)
    if (responseFile)
      jobs.push({ id: r.id, url: bodyUrl(m, responseFile)!, into: responses })
    if (requestFile)
      jobs.push({ id: r.id, url: bodyUrl(m, requestFile)!, into: requests })
    return jobs
  })
  const worker = async (): Promise<void> => {
    for (let job = pending.shift(); job; job = pending.shift()) {
      try {
        job.into.set(job.id, (await (await fetch(job.url)).text()).slice(0, SEARCH_BODY_LIMIT).toLowerCase())
      }
      catch {}
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  if (bodiesLoadedFor === m) {
    responseTexts.value = responses
    requestTexts.value = requests
    loadingBodies.value = false
  }
}

watch(() => store.model.value, () => {
  bodiesLoadedFor = null
  responseTexts.value = new Map()
  requestTexts.value = new Map()
  loadingBodies.value = false
})

// A cross-link from another tab (e.g. a console message) always wins over whatever is filtering the
// list. `immediate` because DetailTabs mounts this view only once detailTab is already 'network', by
// which point the reveal is already set: a non-immediate watch would never see it change.
watch(() => store.networkReveal.value, (reveal) => {
  if (!reveal)
    return
  search.value = ''
  activeCats.value = new Set()
  scope.value = 'all'
  store.clearTimeRange()
  selectedId.value = reveal.resourceId
  // Applied once: coming back to the tab later keeps whatever the user set since.
  store.networkReveal.value = null
}, { immediate: true })

watch([query, searchesBodies], ([q, bodies]) => {
  if (q && bodies)
    void loadResponseTexts()
})

const scopedRows = store.scopedNetworkRows

const matchesById = computed(() => {
  const out = new Map<string, NetworkMatch[]>()
  const q = query.value
  if (!q)
    return out
  for (const row of scopedRows.value) {
    const found = networkMatches(row, q, responseTexts.value.get(row.id), requestTexts.value.get(row.id))
    out.set(row.id, found.filter(field => searchIn.value.includes(field)))
  }
  return out
})

const rows = computed(() => {
  const q = query.value
  return scopedRows.value.filter(r =>
    (!q || !!matchesById.value.get(r.id)?.length)
    && (activeCats.value.size === 0 || activeCats.value.has(r.category)),
  )
})

const features = tableFeatures({
  columnResizingFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: { basic: sortFn_basic, alphanumeric: sortFn_alphanumeric, text: sortFn_text },
})

const columns: ColumnDef<typeof features, NetworkRow>[] = [
  { accessorKey: 'source', header: 'Source', size: 70 },
  { accessorKey: 'name', header: 'Name', size: 240 },
  { accessorKey: 'method', header: 'Method', size: 70 },
  { accessorKey: 'status', header: 'Status', size: 70 },
  { accessorKey: 'contentType', header: 'Content Type', size: 150 },
  { accessorKey: 'duration', header: 'Duration', size: 80 },
  { accessorKey: 'size', header: 'Size', size: 80 },
  { accessorFn: row => row.start ?? -1, id: 'start', header: 'Start', size: 80 },
  { accessorKey: 'route', header: 'Route', size: 80 },
]

const columnSizing = useStorage<Record<string, number>>('kinora-tv-net-col-sizes', {})
const columnResizing = ref()
// The Source column only tells requests apart when several pages or contexts issued them.
const columnVisibility = computed(() => ({ source: new Set(scopedRows.value.map(r => r.source).filter(Boolean)).size > 1 }))
const state = computed(() => ({
  columnResizing: columnResizing.value,
  columnSizing: columnSizing.value,
  columnVisibility: columnVisibility.value,
  sorting: sorting.value,
}))

const table = useTable({
  features,
  get data() { return rows.value },
  columns,
  state,
  columnResizeMode: 'onChange',
  onColumnResizingChange: updater => valueUpdater(updater, columnResizing),
  onColumnSizingChange: (updater) => {
    columnSizing.value = typeof updater === 'function' ? updater(columnSizing.value) : updater
  },
  onSortingChange: updater => valueUpdater(updater, sorting),
})

const selected = computed(() => rows.value.find(r => r.id === selectedId.value) ?? null)
// A request hidden by a filter stays unselected, like upstream, instead of coming back later.
watch(rows, () => {
  if (selectedId.value && !selected.value)
    selectedId.value = null
})

function saveSplit(sizes: number[]): void {
  if (!selected.value)
    return
  if (stacked.value)
    netRows.value = sizes
  else
    netCols.value = sizes
}

// Shows when the hovered request ran on the timeline.
function highlightRow(row: NetworkRow): void {
  const start = row.resource._monotonicTime
  store.setHighlightedTime(start === undefined ? null : { start, end: start + row.duration })
}

function toggleCat(cat: ResourceCategory): void {
  const next = new Set(activeCats.value)
  if (next.has(cat))
    next.delete(cat)
  else next.add(cat)
  activeCats.value = next
}

const emptyMessage = computed(() => {
  if (store.timeRange.value)
    return 'No network in range'
  return scope.value === 'all' ? 'No network in this trace' : 'No network for this action'
})

// Up/Down walk the requests in their sorted order, like upstream's grid; Escape closes the details.
const tableScroller = ref<HTMLElement | null>(null)
async function onTableKey(e: KeyboardEvent): Promise<void> {
  if (e.key === 'Escape' && selectedId.value) {
    selectedId.value = null
    e.preventDefault()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp')
    return
  e.preventDefault()
  const ordered = table.getRowModel().rows.map(row => row.original.id)
  if (!ordered.length)
    return
  const index = selectedId.value ? ordered.indexOf(selectedId.value) : -1
  const next = e.key === 'ArrowDown'
    ? (index === -1 ? 0 : Math.min(index + 1, ordered.length - 1))
    : (index === -1 ? ordered.length - 1 : Math.max(index - 1, 0))
  selectedId.value = ordered[next]
  await nextTick()
  tableScroller.value?.querySelector(`[data-selected]`)?.scrollIntoView({ block: 'nearest' })
}

// Failed or canceled requests read red across the row, like upstream.
function isFailed(row: NetworkRow): boolean {
  return row.status >= 400 || row.status === CANCELED_STATUS
}

const alignEnd = new Set(['size', 'duration', 'start', 'status'])
</script>

<template>
  <div ref="root" class="flex h-full flex-col">
    <!-- filters -->
    <div :class="cn('flex shrink-0 items-center gap-2 border-b border-border px-2', store.detailsDock.value === 'right' ? 'h-12' : 'py-1.5')">
      <div v-if="!store.timeRange.value" class="flex shrink-0 items-center rounded-md bg-muted/60 p-0.5">
        <button
          type="button"
          :class="cn(
            'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
            scope === 'selected' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )"
          @click="scope = 'selected'"
        >
          Selected
        </button>
        <button
          type="button"
          :class="cn(
            'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
            scope === 'all' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )"
          @click="scope = 'all'"
        >
          All
        </button>
      </div>
      <FilterInput v-model="search" :placeholder="searchPlaceholder" class="w-56" />
      <DropdownMenu>
        <DropdownMenuTrigger
          class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
          aria-label="Search in"
          title="Search in"
        >
          <ListFilter class="size-3.5" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" class="w-44">
          <DropdownMenuLabel>Search in</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            v-for="f in NETWORK_SEARCH_FIELDS"
            :key="f.field"
            :model-value="searchIn.includes(f.field)"
            @update:model-value="setSearchIn(f.field, $event)"
          >
            {{ f.label }}
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <span v-if="loadingBodies && query && searchesBodies" class="shrink-0 text-[11px] text-muted-foreground">searching bodies…</span>
      <div class="flex items-center gap-1">
        <button
          v-for="cat in RESOURCE_CATEGORIES"
          :key="cat"
          type="button"
          :class="cn(
            'rounded px-1.5 py-0.5 text-[11px] transition-colors',
            activeCats.has(cat) ? 'bg-signal/15 text-signal' : 'text-muted-foreground hover:text-foreground',
          )"
          @click="toggleCat(cat)"
        >
          {{ cat }}
        </button>
      </div>
      <span class="ml-auto font-mono text-[11px] text-muted-foreground">{{ rows.length }}</span>
    </div>

    <div v-if="!rows.length" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">
      {{ emptyMessage }}
    </div>

    <ResizablePanelGroup
      v-else
      :key="stacked ? 'stacked' : 'side'"
      :direction="stacked ? 'vertical' : 'horizontal'"
      data-testid="net-split"
      :data-stacked="stacked || undefined"
      class="min-h-0 flex-1"
      @layout="saveSplit"
    >
      <!-- table -->
      <ResizablePanel id="net-table" :order="1" :default-size="selected ? split[0] : 100">
        <div
          ref="tableScroller"
          data-testid="net-table"
          tabindex="0"
          aria-label="Network requests"
          class="h-full overflow-auto outline-none"
          @keydown="onTableKey"
        >
          <table class="w-full table-fixed text-xs" :style="{ minWidth: `${table.getTotalSize()}px` }">
            <thead class="sticky top-0 z-10 bg-background">
              <tr class="border-b border-border">
                <th
                  v-for="header in table.getHeaderGroups()[0].headers"
                  :key="header.id"
                  :data-col="header.column.id"
                  :style="{ width: `${header.getSize()}px` }"
                  :class="cn(
                    'relative cursor-pointer px-3 py-1.5 font-medium text-muted-foreground select-none hover:text-foreground',
                    alignEnd.has(header.column.id) ? 'text-right' : 'text-left',
                  )"
                  @click="header.column.toggleSorting()"
                >
                  <span class="inline-flex max-w-full items-center gap-1">
                    <span class="truncate">{{ header.column.columnDef.header }}</span>
                    <ChevronUp v-if="header.column.getIsSorted() === 'asc'" class="size-3" />
                    <ChevronDown v-else-if="header.column.getIsSorted() === 'desc'" class="size-3" />
                  </span>
                  <div
                    data-testid="net-col-resizer"
                    title="Drag to resize, double-click to reset"
                    class="group/resizer absolute top-0 -right-1.5 z-10 flex h-full w-3 cursor-col-resize touch-none justify-center"
                    @click.stop
                    @dblclick.stop="header.column.resetSize()"
                    @mousedown="header.getResizeHandler()($event)"
                    @touchstart="header.getResizeHandler()($event)"
                  >
                    <span
                      :class="cn(
                        'my-auto h-3.5 w-px bg-border transition-all group-hover/resizer:h-full group-hover/resizer:w-0.5 group-hover/resizer:bg-signal',
                        header.column.getIsResizing() && 'h-full w-0.5 bg-signal',
                      )"
                    />
                  </div>
                </th>
                <!-- Takes the leftover width so resized columns keep exactly their size. -->
                <th aria-hidden="true" class="p-0" />
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in table.getRowModel().rows"
                :key="row.original.id"
                data-testid="net-row"
                :data-route="row.original.route"
                :data-failed="isFailed(row.original) || undefined"
                :data-selected="selectedId === row.original.id || undefined"
                :class="cn(
                  'cursor-pointer border-b border-border/40 transition-colors',
                  selectedId === row.original.id
                    ? 'bg-signal/10'
                    : isFailed(row.original) ? 'bg-fail/5 hover:bg-fail/10' : row.original.route ? 'bg-info/10 hover:bg-info/15' : 'hover:bg-muted/40',
                  isFailed(row.original) && '[&_td]:text-fail [&_td_*]:text-fail',
                )"
                @click="selectedId = row.original.id"
                @mouseenter="highlightRow(row.original)"
                @mouseleave="store.setHighlightedTime(null)"
              >
                <td
                  v-for="cell in row.getVisibleCells()"
                  :key="cell.id"
                  :data-col="cell.column.id"
                  :class="cn('truncate px-3 py-1', alignEnd.has(cell.column.id) && 'text-right font-mono tabular-nums')"
                >
                  <div v-if="cell.column.id === 'name'" class="flex min-w-0 items-center gap-1.5 font-mono text-foreground/90">
                    <TextTooltip :text="row.original.name" :tip="row.original.url" class="block min-w-0" />
                    <span
                      v-for="where in (matchesById.get(row.original.id) ?? []).filter(m => m !== 'url')"
                      :key="where"
                      data-testid="net-match"
                      class="shrink-0 rounded bg-signal/15 px-1 font-sans text-[10px] text-signal"
                    >{{ where }}</span>
                  </div>
                  <span v-else-if="cell.column.id === 'status'" :class="statusClass(row.original.status)">{{ statusLabel(row.original.status) }}</span>
                  <span v-else-if="cell.column.id === 'size'" class="text-muted-foreground">{{ formatSize(row.original.size) }}</span>
                  <span v-else-if="cell.column.id === 'duration'" class="text-muted-foreground">{{ formatMs(row.original.duration) }}</span>
                  <span v-else-if="cell.column.id === 'start'" class="text-muted-foreground">{{ formatMs(row.original.start) }}</span>
                  <span v-else-if="cell.column.id === 'route'" :class="row.original.route === 'aborted' ? 'text-fail' : 'text-info'">{{ row.original.route ?? '' }}</span>
                  <span v-else class="text-muted-foreground" :title="String(cell.getValue() ?? '')">{{ cell.getValue() }}</span>
                </td>
                <td class="p-0" />
              </tr>
            </tbody>
          </table>
        </div>
      </ResizablePanel>

      <!-- detail -->
      <template v-if="selected">
        <ResizableHandle with-handle />
        <ResizablePanel id="net-detail" :order="2" :default-size="split[1]" :min-size="20" :max-size="stacked ? 80 : 60">
          <NetworkDetails :row="selected" @close="selectedId = null" />
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>
  </div>
</template>
