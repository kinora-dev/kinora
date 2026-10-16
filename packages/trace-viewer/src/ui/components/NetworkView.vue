<script setup lang="ts">
import type { ColumnDef, SortingState } from '@tanstack/vue-table'
import type { NetworkMatch, NetworkRow, ResourceCategory } from '../lib/network'
import { cn } from '@kinora/ui'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@kinora/ui/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@kinora/ui/resizable'
import { valueUpdater } from '@kinora/ui/table/utils'
import { ChevronDown, ChevronUp, Copy, ListFilter } from '@lucide/vue'
import { getCoreRowModel, getSortedRowModel, useVueTable } from '@tanstack/vue-table'
import { useStorage } from '@vueuse/core'
import { computed, ref, shallowRef, watch } from 'vue'
import { allResources, bodyUrl, formatSize, isTextMime, NETWORK_SEARCH_FIELDS, networkMatches, prettyJson, RESOURCE_CATEGORIES, resourcesForAction, resourcesInWindow, SEARCH_BODY_LIMIT, searchableRequestFile, searchableResponseFile, statusClass, toCurl, toFetch } from '../lib/network'
import { useTraceStore } from '../store'
import FilterInput from './FilterInput.vue'
import TextTooltip from './TextTooltip.vue'

const store = useTraceStore()

// Persisted [table, detail] widths (percentages); applied only while a row is selected.
const netCols = useStorage('kinora-tv-net-cols', [62, 38])

type Scope = 'selected' | 'all'

const search = ref('')
const activeCats = ref<Set<ResourceCategory>>(new Set())
const sorting = ref<SortingState>([])
const selectedId = ref<string | null>(null)
const scope = ref<Scope>('selected')
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

watch([query, searchesBodies], ([q, bodies]) => {
  if (q && bodies)
    void loadResponseTexts()
})

const matchesById = computed(() => {
  const out = new Map<string, NetworkMatch[]>()
  const q = query.value
  if (!q)
    return out
  for (const r of store.model.value?.resources ?? []) {
    const found = networkMatches(allResources([r])[0], q, responseTexts.value.get(r.id), requestTexts.value.get(r.id))
    out.set(r.id, found.filter(field => searchIn.value.includes(field)))
  }
  return out
})

const rows = computed(() => {
  const resources = store.model.value?.resources ?? []
  const range = store.timeRange.value
  const all = range
    ? resourcesInWindow(resources, range)
    : scope.value === 'all'
      ? allResources(resources)
      : resourcesForAction(resources, store.selectedAction.value)
  const q = query.value
  return all.filter(r =>
    (!q || !!matchesById.value.get(r.id)?.length)
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
  { accessorKey: 'route', header: 'Route' },
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

interface Body { kind: 'image' | 'text' | 'download' | 'none', url?: string, text?: string, raw?: string, canPretty?: boolean }
const requestBody = ref<Body>({ kind: 'none' })
const responseBody = ref<Body>({ kind: 'none' })
const showRawRequest = ref(false)
const showRawResponse = ref(false)
const requestBodyText = computed(() => showRawRequest.value && requestBody.value.raw ? requestBody.value.raw : requestBody.value.text)
const responseBodyText = computed(() => showRawResponse.value && responseBody.value.raw ? responseBody.value.raw : responseBody.value.text)

function headerValue(headers: { name: string, value: string }[] | undefined, name: string): string {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''
}

async function loadBody(file: string | undefined, mime: string, inlineText = ''): Promise<Body> {
  const url = bodyUrl(store.model.value, file)
  if (mime.startsWith('image/') && url)
    return { kind: 'image', url }
  if (!isTextMime(mime))
    return url ? { kind: 'download', url } : { kind: 'none' }

  try {
    const raw = (inlineText || (url ? await (await fetch(url)).text() : '')).slice(0, 200_000)
    if (!raw)
      return url ? { kind: 'download', url } : { kind: 'none' }
    const pretty = prettyJson(raw, mime)
    return { kind: 'text', url, text: (pretty ?? raw).slice(0, 50_000), raw: raw.slice(0, 50_000), canPretty: pretty !== null }
  }
  catch {
    return url ? { kind: 'download', url } : { kind: 'none' }
  }
}

watch(selected, async (sel) => {
  requestBody.value = { kind: 'none' }
  responseBody.value = { kind: 'none' }
  showRawRequest.value = false
  showRawResponse.value = false
  if (!sel)
    return

  const postData = sel.resource.request.postData
  requestBody.value = await loadBody(
    postData?._file,
    postData?.mimeType ?? headerValue(sel.resource.request.headers, 'content-type'),
    postData?.text,
  )

  const content = sel.resource.response?.content
  responseBody.value = await loadBody(content?._file, content?.mimeType ?? '')
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

const emptyMessage = computed(() => {
  if (store.timeRange.value)
    return 'No network in range'
  return scope.value === 'all' ? 'No network in this trace' : 'No network for this action'
})

const alignEnd = new Set(['size', 'duration', 'status'])
</script>

<template>
  <div class="flex h-full flex-col">
    <!-- filters -->
    <div class="flex shrink-0 items-center gap-2 border-b border-border px-2 py-1.5">
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
                :data-route="row.original.route"
                :class="cn(
                  'cursor-pointer border-b border-border/40 transition-colors',
                  selectedId === row.original.id
                    ? 'bg-signal/10'
                    : row.original.route ? 'bg-info/10 hover:bg-info/15' : 'hover:bg-muted/40',
                )"
                @click="selectedId = row.original.id"
              >
                <td class="max-w-0 px-3 py-1 font-mono text-foreground/90">
                  <div class="flex min-w-0 items-center gap-1.5">
                    <TextTooltip :text="row.original.name" :tip="row.original.url" class="block min-w-0" />
                    <span
                      v-for="where in (matchesById.get(row.original.id) ?? []).filter(m => m !== 'url')"
                      :key="where"
                      data-testid="net-match"
                      class="shrink-0 rounded bg-signal/15 px-1 font-sans text-[10px] text-signal"
                    >{{ where }}</span>
                  </div>
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
                <td class="px-3 py-1" :class="row.original.route === 'aborted' ? 'text-fail' : 'text-info'">
                  {{ row.original.route ?? '' }}
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
          <div data-testid="net-detail" class="h-full overflow-auto p-3 text-xs">
            <div class="mb-3 flex items-start gap-2">
              <div class="min-w-0 flex-1">
                <div class="mb-1 flex items-center gap-2">
                  <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{{ selected.method }}</span>
                  <span class="font-mono tabular-nums" :class="statusClass(selected.status)">{{ selected.status || '-' }}</span>
                  <span class="text-muted-foreground">{{ selected.resource.response?.statusText }}</span>
                </div>
                <div class="font-mono break-all text-foreground/90">
                  {{ selected.url }}
                </div>
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

            <div class="mb-4 grid grid-cols-2 gap-2 rounded-md border border-border bg-muted/20 p-2 text-muted-foreground">
              <div>
                <span class="uppercase tracking-wide">Type</span>
                <div class="font-mono text-foreground/90">
                  {{ selected.category }}
                </div>
              </div>
              <div>
                <span class="uppercase tracking-wide">Duration</span>
                <div class="font-mono text-foreground/90">
                  {{ Math.round(selected.duration) }}ms
                </div>
              </div>
              <div>
                <span class="uppercase tracking-wide">Size</span>
                <div class="font-mono text-foreground/90">
                  {{ formatSize(selected.size) }}
                </div>
              </div>
              <div v-if="selected.route">
                <span class="uppercase tracking-wide">Route</span>
                <div class="font-mono text-info">
                  {{ selected.route }}
                </div>
              </div>
              <div>
                <span class="uppercase tracking-wide">Started</span>
                <div class="font-mono text-foreground/90">
                  {{ Math.round(selected.resource._monotonicTime ?? 0) }}ms
                </div>
              </div>
            </div>

            <section v-if="requestBody.kind !== 'none' || requestBody.url" class="mb-4">
              <div class="mb-1 flex items-center gap-2">
                <span class="font-semibold tracking-wide text-muted-foreground uppercase">
                  Request body
                </span>
                <button
                  v-if="requestBody.canPretty"
                  type="button"
                  class="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  @click="showRawRequest = !showRawRequest"
                >
                  {{ showRawRequest ? 'Pretty' : 'Raw' }}
                </button>
              </div>
              <pre v-if="requestBody.kind === 'text'" class="max-h-56 overflow-auto rounded bg-muted/40 p-2 font-mono whitespace-pre-wrap">{{ requestBodyText }}</pre>
              <a v-else-if="requestBody.url" :href="requestBody.url" download class="text-muted-foreground hover:text-foreground">download body</a>
            </section>

            <section v-if="responseBody.kind !== 'none' || responseBody.url" class="mb-4">
              <div class="mb-1 flex items-center gap-2">
                <span class="font-semibold tracking-wide text-muted-foreground uppercase">
                  Response body
                </span>
                <button
                  v-if="responseBody.canPretty"
                  type="button"
                  class="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:text-foreground"
                  @click="showRawResponse = !showRawResponse"
                >
                  {{ showRawResponse ? 'Pretty' : 'Raw' }}
                </button>
              </div>
              <img v-if="responseBody.kind === 'image'" :src="responseBody.url" class="max-h-48 rounded border border-border">
              <pre v-else-if="responseBody.kind === 'text'" class="max-h-56 overflow-auto rounded bg-muted/40 p-2 font-mono whitespace-pre-wrap">{{ responseBodyText }}</pre>
              <a v-else-if="responseBody.url" :href="responseBody.url" download class="text-muted-foreground hover:text-foreground">download body</a>
            </section>

            <section class="mb-4">
              <div class="mb-1 font-semibold tracking-wide text-muted-foreground uppercase">
                Request headers
              </div>
              <div class="flex flex-col gap-0.5 font-mono">
                <div v-for="(h, i) in selected.resource.request?.headers ?? []" :key="i" class="break-all">
                  <span class="text-muted-foreground">{{ h.name }}:</span> {{ h.value }}
                </div>
              </div>
            </section>

            <section>
              <div class="mb-1 font-semibold tracking-wide text-muted-foreground uppercase">
                Response headers
              </div>
              <div class="flex flex-col gap-0.5 font-mono">
                <div v-for="(h, i) in selected.resource.response?.headers ?? []" :key="i" class="break-all">
                  <span class="text-muted-foreground">{{ h.name }}:</span> {{ h.value }}
                </div>
              </div>
            </section>
          </div>
        </ResizablePanel>
      </template>
    </ResizablePanelGroup>
  </div>
</template>
