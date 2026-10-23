<script setup lang="ts">
import type { ConsoleMessageTraceEvent } from '@trace/trace'
import { cn } from '@kinora/ui'
import { computed, ref } from 'vue'
import { formatMs } from '../lib/format'
import { resourceAtUrl } from '../lib/network'
import { inWindow } from '../lib/timeline'
import { useTraceStore } from '../store'

const store = useTraceStore()
type Scope = 'selected' | 'all'
const scope = ref<Scope>('selected')

const messages = computed(() => {
  const range = store.timeRange.value
  const source = range
    ? (store.model.value?.events ?? []).filter(e => inWindow(e.time, range))
    : scope.value === 'all'
      ? (store.model.value?.events ?? [])
      : store.activeAction.value
        ? (store.model.value?.eventsForAction(store.activeAction.value) ?? [])
        : []
  const resources = store.model.value?.resources ?? []
  const start = store.model.value?.startTime ?? 0
  return source
    .filter((e): e is ConsoleMessageTraceEvent => e.type === 'console')
    .map((e) => {
      const args = e.args ?? []
      return {
        args: args.length === 1 && args[0].preview === e.text ? [] : args,
        kind: consoleKind(e.messageType),
        location: e.location,
        locationLabel: formatLocation(e),
        networkResourceId: e.location?.url ? resourceAtUrl(resources, e.location.url, e.time)?.id : undefined,
        text: e.text,
        time: formatMs(e.time - start),
        type: e.messageType,
      }
    })
})

function consoleKind(type: string): 'error' | 'warning' | 'log' {
  if (type === 'error')
    return 'error'
  if (type === 'warning' || type === 'warn')
    return 'warning'
  return 'log'
}

function formatLocation(event: ConsoleMessageTraceEvent): string {
  const url = event.location?.url ?? ''
  const line = event.location?.lineNumber ?? 0
  const column = event.location?.columnNumber ?? 0
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

const kindClass: Record<string, string> = {
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
      <span class="ml-auto font-mono text-[11px] text-muted-foreground">{{ messages.length }}</span>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto py-1">
      <div v-if="!messages.length" class="flex h-full items-center justify-center text-sm text-muted-foreground">
        {{ emptyMessage }}
      </div>
      <div
        v-for="(msg, i) in messages"
        :key="i"
        :class="cn('border-l-2 px-3 py-2 font-mono text-xs', kindClass[msg.kind])"
      >
        <div class="mb-1 flex items-center gap-2 text-[10px] text-muted-foreground">
          <span class="rounded bg-muted px-1.5 py-0.5 uppercase tracking-wide">{{ msg.type }}</span>
          <span data-testid="console-time" class="tabular-nums">{{ msg.time }}</span>
          <button
            v-if="msg.networkResourceId"
            type="button"
            data-testid="console-network-link"
            class="ml-auto min-w-0 truncate underline-offset-2 hover:underline"
            @click="store.revealNetworkResource(msg.networkResourceId)"
          >
            {{ msg.locationLabel }}
          </button>
          <a
            v-else-if="msg.location?.url"
            :href="msg.location.url"
            target="_blank"
            rel="noreferrer"
            class="ml-auto min-w-0 truncate underline-offset-2 hover:underline"
          >{{ msg.locationLabel }}</a>
          <span v-else class="ml-auto min-w-0 truncate">{{ msg.locationLabel }}</span>
        </div>
        <div class="whitespace-pre-wrap break-words text-foreground/90">
          {{ msg.text }}
        </div>
        <div v-if="msg.args.length" class="mt-1 flex flex-col gap-1">
          <div
            v-for="(arg, j) in msg.args"
            :key="j"
            class="rounded border border-border/70 bg-background/60 px-2 py-1 text-[11px] text-muted-foreground"
          >
            <span class="text-foreground/80">arg {{ j + 1 }}</span>
            <span class="mx-1">·</span>
            <span class="whitespace-pre-wrap break-words">{{ arg.preview || String(arg.value) }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
