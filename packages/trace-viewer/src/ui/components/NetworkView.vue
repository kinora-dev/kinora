<script setup lang="ts">
import type { ColumnDef, SortingState } from '@tanstack/vue-table'
import type { NetworkRow, ResourceCategory } from '../lib/network'
import { cn } from '@kinora/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@kinora/ui/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@kinora/ui/resizable'
import { valueUpdater } from '@kinora/ui/table/utils'
import { ChevronDown, ChevronUp, Copy } from '@lucide/vue'
import { getCoreRowModel, getSortedRowModel, useVueTable } from '@tanstack/vue-table'
import { useStorage } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { bodyUrl, formatSize, prettyJson, RESOURCE_CATEGORIES, resourcesForAction, resourcesInWindow, statusClass, toCurl, toFetch } from '../lib/network'
import { useTraceStore } from '../store'
import FilterInput from './FilterInput.vue'
import TextTooltip from './TextTooltip.vue'

const store = useTraceStore()

// Persisted [table, detail] widths (percentages); applied only while a row is selected.
const netCols = useStorage('kinora-tv-net-cols', [62, 38])

const search = ref('')
const activeCats = ref<Set<ResourceCategory>>(new Set())
const sorting = ref<SortingState>([])
const selectedId = ref<string | null>(null)

const rows = computed(() => {
  const resources = store.model.value?.resources ?? []
  const range = store.timeRange.value
  const all = range
    ? resourcesInWindow(resources, range)
    : resourcesForAction(resources, store.selectedAction.value)
  const q = search.value.trim().toLowerCase()
  return all.filter(r =>
    (!q || r.url.toLowerCase().includes(q))
    && (activeCats.value.size === 0 || activeCats.value.has(r.category)),
  )
})

const columns: ColumnDef<NetworkRow>[] = [
  { accessorKey: 'name', header: 'Name' },
  { accessorKey: 'method', header: 'Method' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'category', header: 'Type' },
  { accessorKey: 'size', header: 'Size' },
  { accessorKey: 'duration', header: 'Time' },
]

const table = useVueTable({
  get data() { return rows.value },
  columns,
  getCoreRowModel: getCoreRowModel(),
  getSortedRowModel: getSortedRowModel(),
  state: {
    get sorting() { return sorting.value },
  },
  onSortingChange: updater => valueUpdater(updater, sorting),
})

const selected = computed(() => rows.value.find(r => r.id === selectedId.value) ?? null)

interface Body { kind: 'image' | 'text' | 'none', url?: string, text?: string, raw?: string, canPretty?: boolean }
const body = ref<Body>({ kind: 'none' })
const showRaw = ref(false)
const bodyText = computed(() => showRaw.value && body.value.raw ? body.value.raw : body.value.text)

watch(selected, async (sel) => {
  body.value = { kind: 'none' }
  showRaw.value = false
  if (!sel)
    return
  const content = sel.resource.response?.content
  const url = bodyUrl(store.model.value, content?._file)
  if (!url)
    return
  const mime = content?.mimeType ?? ''
  if (mime.startsWith('image/')) {
    body.value = { kind: 'image', url }
    return
  }
  if (mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript')) {
    try {
      const raw = (await (await fetch(url)).text()).slice(0, 200_000)
      const pretty = prettyJson(raw, mime)
      body.value = { kind: 'text', url, text: (pretty ?? raw).slice(0, 50_000), raw: raw.slice(0, 50_000), canPretty: pretty !== null }
    }
    catch {
      body.value = { kind: 'none', url }
    }
    return
  }
  body.value = { kind: 'none', url }
})

function copy(text: string): void {
  void navigator.clipboard.writeText(text)
}

function toggleCat(cat: ResourceCategory): void {
  const next = new Set(activeCats.value)
  if (next.has(cat))
    next.delete(cat)
  else next.add(cat)
  activeCats.value = next
}

const alignEnd = new Set(['size', 'duration', 'status'])
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- filters -->
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
      <FilterInput v-model="search" placeholder="Filter network" class="w-48" />
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
      {{ store.timeRange.value ? 'No network in range' : 'No network for this action' }}
    </div>

    <ResizablePanelGroup
      v-else
      direction="horizontal"
      class="min-h-0 flex-1"
      @layout="(s: number[]) => { if (selected) netCols = s }"
    >
      <!-- table -->
      <ResizablePanel id="net-table" :order="1" :default-size="selected ? netCols[0] : 100">
        <div class="h-full overflow-auto">
          <table class="w-full text-xs">
            <thead class="sticky top-0 bg-background">
              <tr class="border-b border-border">
                <th
                  v-for="header in table.getHeaderGroups()[0].headers"
                  :key="header.id"
                  :class="cn(
                    'cursor-pointer px-3 py-1.5 font-medium text-muted-foreground select-none hover:text-foreground',
                    alignEnd.has(header.column.id) ? 'text-right' : 'text-left',
                  )"
                  @click="header.column.toggleSorting()"
                >
                  <span class="inline-flex items-center gap-1">
                    {{ header.column.columnDef.header }}
                    <ChevronUp v-if="header.column.getIsSorted() === 'asc'" class="size-3" />
                    <ChevronDown v-else-if="header.column.getIsSorted() === 'desc'" class="size-3" />
                  </span>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="row in table.getRowModel().rows"
                :key="row.original.id"
                data-testid="net-row"
                :class="cn(
                  'cursor-pointer border-b border-border/40 transition-colors',
                  selectedId === row.original.id ? 'bg-signal/10' : 'hover:bg-muted/40',
                )"
                @click="selectedId = row.original.id"
              >
                <td class="max-w-0 px-3 py-1 font-mono text-foreground/90">
                  <TextTooltip :text="row.original.name" :tip="row.original.url" class="block" />
                </td>
                <td class="px-3 py-1 text-muted-foreground">
                  {{ row.original.method }}
                </td>
                <td class="px-3 py-1 text-right font-mono tabular-nums" :class="statusClass(row.original.status)">
                  {{ row.original.status || '-' }}
                </td>
                <td class="px-3 py-1 text-muted-foreground">
                  {{ row.original.category }}
                </td>
                <td class="px-3 py-1 text-right font-mono tabular-nums text-muted-foreground">
                  {{ formatSize(row.original.size) }}
                </td>
                <td class="px-3 py-1 text-right font-mono tabular-nums text-muted-foreground">
                  {{ Math.round(row.original.duration) }}ms
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </ResizablePanel>

      <!-- detail -->
      <template v-if="selected">
        <ResizableHandle with-handle />
        <ResizablePanel id="net-detail" :order="2" :default-size="netCols[1]" :min-size="20" :max-size="60">
          <div class="h-full overflow-auto p-3 text-xs">
            <div class="mb-2 flex items-start gap-2">
              <div class="min-w-0 flex-1 font-mono break-all text-foreground/90">
                {{ selected.url }}
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger
                  class="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  title="Copy"
                >
                  <Copy class="size-3.5" />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem @click="copy(selected.url)">
                    Copy URL
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="copy(toCurl(selected.resource))">
                    Copy as cURL
                  </DropdownMenuItem>
                  <DropdownMenuItem @click="copy(toFetch(selected.resource))">
                    Copy as fetch
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div class="mb-3 flex gap-3 text-muted-foreground">
              <span>{{ selected.method }}</span>
              <span :class="statusClass(selected.status)">{{ selected.status || '-' }}</span>
              <span>{{ formatSize(selected.size) }}</span>
            </div>

            <template v-if="body.kind !== 'none' || body.url">
              <div class="mb-1 flex items-center gap-2">
                <span class="font-semibold tracking-wide text-muted-foreground uppercase">
                  Response body
                </span>
                <button
                  v-if="body.canPretty"
                  type="button"
                  class="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  @click="showRaw = !showRaw"
                >
                  {{ showRaw ? 'Pretty' : 'Raw' }}
                </button>
              </div>
              <div class="mb-3">
                <img v-if="body.kind === 'image'" :src="body.url" class="max-h-48 rounded border border-border">
                <pre v-else-if="body.kind === 'text'" class="max-h-48 overflow-auto rounded bg-muted/40 p-2 font-mono whitespace-pre-wrap">{{ bodyText }}</pre>
                <a v-else-if="body.url" :href="body.url" download class="text-muted-foreground hover:text-foreground">download body</a>
              </div>
            </template>

            <div class="mb-1 font-semibold tracking-wide text-muted-foreground uppercase">
              Response headers
            </div>
            <div class="mb-3 flex flex-col gap-0.5 font-mono">
              <div v-for="(h, i) in selected.resource.response?.headers ?? []" :key="i" class="break-all">
                <span class="text-muted-foreground">{{ h.name }}:</span> {{ h.value }}
              </div>
            </div>
            <div class="mb-1 font-semibold tracking-wide text-muted-foreground uppercase">
              Request headers
            </div>
            <div class="flex flex-col gap-0.5 font-mono">
              <div v-for="(h, i) in selected.resource.request?.headers ?? []" :key="i" class="break-all">
                <span class="text-muted-foreground">{{ h.name }}:</span> {{ h.value }}
              </div>
            </div>
          </div>
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>
  </div>
</template>
