<script setup lang="ts">
import type { ConsoleEntry } from '../lib/console'
import { cn } from '@kinora/ui'
import { computed, ref } from 'vue'
import { consoleEntries } from '../lib/console'
import { formatMs } from '../lib/format'
import { resourceAtUrl } from '../lib/network'
import { inWindow } from '../lib/timeline'
import { useTraceStore } from '../store'

const store = useTraceStore()
type Scope = 'selected' | 'all'
const scope = ref<Scope>('selected')

const entries = computed(() => {
  const model = store.model.value
  if (!model)
    return []
  const range = store.timeRange.value
  const action = store.activeAction.value
  let events = model.events
  let stdio = model.stdio
  if (range) {
    events = events.filter(e => inWindow(e.time, range))
    stdio = stdio.filter(e => inWindow(e.timestamp, range))
  }
  else if (scope.value === 'selected') {
    events = action ? model.eventsForAction(action) : []
    stdio = action ? stdio.filter(e => e.timestamp >= action.startTime && e.timestamp <= (action.endTime || action.startTime)) : []
  }
  const pageTitle = (id: string | undefined) => (id && model.resourceOwnerRefToTitle.get(id)) || ''
  return consoleEntries({ events, stdio, pageTitle }).map(entry => ({
    ...entry,
    locationLabel: entry.console && formatLocation(entry),
    networkResourceId: entry.console?.location?.url ? resourceAtUrl(model.resources, entry.console.location.url, entry.time)?.id : undefined,
  }))
})

// The source badge only says something when pages differ or runner output is mixed in, like upstream.
const showSource = computed(() => new Set(entries.value.filter(e => e.source !== 'test').map(e => e.source)).size > 1
  || entries.value.some(e => e.source === 'test'))

function formatLocation(entry: ConsoleEntry): string {
  const location = entry.console?.location
  const url = location?.url ?? ''
  const line = location?.lineNumber ?? 0
  const column = location?.columnNumber ?? 0
  const file = url ? (url.split('/').pop() || url) : '<inline>'
  if (!line && !column)
    return file
  return `${file}:${line}:${column}`
}

const emptyMessage = computed(() => {
  if (store.timeRange.value)
    return 'No console output in range'
  return scope.value === 'all' ? 'No console output in this trace' : 'No console output for this action'
})

const levelClass: Record<string, string> = {
  error: 'text-fail border-l-fail/60 bg-fail/5',
  warning: 'text-flaky border-l-flaky/60 bg-flaky/5',
  log: 'text-foreground/80 border-l-transparent',
}
</script>

<template>
  <div class="flex h-full flex-col">
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
      <span class="ml-auto font-mono text-[11px] text-muted-foreground">{{ entries.length }}</span>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto py-1">
      <div v-if="!entries.length" class="flex h-full items-center justify-center text-sm text-muted-foreground">
        {{ emptyMessage }}
      </div>
      <div
        v-for="(entry, i) in entries"
        :key="i"
        data-testid="console-entry"
        :data-level="entry.level"
        :title="`Select the action running at ${formatMs(entry.time - (store.model.value?.startTime ?? 0))}`"
        :class="cn('cursor-pointer border-l-2 px-3 py-2 font-mono text-xs hover:bg-muted/40', levelClass[entry.level])"
        @click="store.selectAtTime(entry.time)"
      >
        <div class="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span class="rounded bg-muted px-1.5 py-0.5 uppercase tracking-wide">{{ entry.label }}</span>
          <span data-testid="console-time" class="tabular-nums">{{ formatMs(entry.time - (store.model.value?.startTime ?? 0)) }}</span>
          <span v-if="showSource" data-testid="console-source" class="rounded border border-border px-1 py-px" :title="entry.source === 'test' ? 'Runner message' : 'Browser message'">{{ entry.source || 'page' }}</span>
          <span v-if="entry.repeat > 1" data-testid="console-repeat" class="rounded-full bg-muted-foreground/20 px-1.5 tabular-nums text-foreground/80">{{ entry.repeat }}</span>
          <button
            v-if="entry.networkResourceId"
            type="button"
            data-testid="console-network-link"
            class="ml-auto min-w-0 truncate underline-offset-2 hover:underline"
            @click.stop="store.revealNetworkResource(entry.networkResourceId)"
          >
            {{ entry.locationLabel }}
          </button>
          <a
            v-else-if="entry.console?.location?.url"
            :href="entry.console.location.url"
            target="_blank"
            rel="noreferrer"
            class="ml-auto min-w-0 truncate underline-offset-2 hover:underline"
            @click.stop
          >{{ entry.locationLabel }}</a>
          <span v-else-if="entry.locationLabel" class="ml-auto min-w-0 truncate">{{ entry.locationLabel }}</span>
        </div>
        <div data-testid="console-body" class="whitespace-pre-wrap break-words text-foreground/90">
          <span v-for="(segment, j) in entry.body" :key="j" :style="segment.style">{{ segment.text }}</span>
        </div>
        <pre v-if="entry.stack" data-testid="console-stack" class="mt-1 whitespace-pre-wrap break-words text-[11px] text-muted-foreground">{{ entry.stack }}</pre>
      </div>
    </div>
  </div>
</template>
