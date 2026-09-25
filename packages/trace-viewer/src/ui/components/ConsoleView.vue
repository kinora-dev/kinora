<script setup lang="ts">
import type { ConsoleMessageTraceEvent } from '@trace/trace'
import { cn } from '@kinora/ui'
import { computed } from 'vue'
import { inWindow } from '../lib/timeline'
import { useTraceStore } from '../store'

const store = useTraceStore()

const messages = computed(() => {
  const range = store.timeRange.value
  const source = range
    ? (store.model.value?.events ?? []).filter(e => inWindow(e.time, range))
    : store.selectedAction.value
      ? (store.model.value?.eventsForAction(store.selectedAction.value) ?? [])
      : []
  return source
    .filter((e): e is ConsoleMessageTraceEvent => e.type === 'console')
    .map(e => ({
      kind: e.messageType === 'error' ? 'error' : e.messageType === 'warning' ? 'warning' : 'log',
      text: e.text,
      location: e.location?.url ? `${e.location.url.split('/').pop()}:${e.location.lineNumber}` : '',
    }))
})

const kindClass: Record<string, string> = {
  error: 'text-fail border-l-fail/60 bg-fail/5',
  warning: 'text-flaky border-l-flaky/60 bg-flaky/5',
  log: 'text-foreground/80 border-l-transparent',
}
</script>

<template>
  <div class="h-full overflow-y-auto py-1">
    <div v-if="!messages.length" class="flex h-full items-center justify-center text-sm text-muted-foreground">
      {{ store.timeRange.value ? 'No console output in range' : 'No console output for this action' }}
    </div>
    <div
      v-for="(msg, i) in messages"
      :key="i"
      :class="cn('flex items-start gap-3 border-l-2 px-3 py-1 font-mono text-xs', kindClass[msg.kind])"
    >
      <span class="min-w-0 flex-1 whitespace-pre-wrap break-words">{{ msg.text }}</span>
      <span v-if="msg.location" class="shrink-0 text-muted-foreground/60">{{ msg.location }}</span>
    </div>
  </div>
</template>
