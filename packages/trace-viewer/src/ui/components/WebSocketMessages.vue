<script setup lang="ts">
import type { ResourceEntry } from '@isomorphic/trace/traceModel'
import type { IndexedMessage } from '../lib/websocket'
import { cn } from '@kinora/ui'
import { ArrowDown, ArrowUp, Braces } from '@lucide/vue'
import { useStorage } from '@vueuse/core'
import { computed, defineAsyncComponent, nextTick, ref, watch } from 'vue'
import { formatMs } from '../lib/format'
import { bodyLang, bodyUrl, formatBody, formatSize } from '../lib/network'
import { messageBody, messagePreview, opcodeName, parseMessages } from '../lib/websocket'
import { useTraceStore } from '../store'

const props = defineProps<{ resource: ResourceEntry }>()

const CodeView = defineAsyncComponent(() => import('./CodeView.vue'))

const store = useTraceStore()
const messages = ref<IndexedMessage[]>()
const selectedIndex = ref<number>()
const pretty = useStorage('kinora-tv-net-pretty-ws-message', true)

watch(() => props.resource, async (resource, _, onCleanup) => {
  let stale = false
  onCleanup(() => (stale = true))
  messages.value = undefined
  selectedIndex.value = undefined
  let jsonl: string | undefined
  const url = resource._webSocketMessages ? undefined : bodyUrl(store.model.value, resource.response.content._file)
  try {
    if (url) {
      const res = await fetch(url)
      jsonl = res.ok ? await res.text() : ''
    }
    if (!stale)
      messages.value = parseMessages(resource._webSocketMessages, jsonl)
  }
  catch {
    if (!stale)
      messages.value = []
  }
}, { immediate: true })

// Times are relative to the first timed frame, like upstream.
const baseTime = computed(() => messages.value?.find(m => m.time > 0)?.time)
const selected = computed(() => selectedIndex.value === undefined ? undefined : messages.value?.[selectedIndex.value])

const body = computed(() => {
  const message = selected.value
  if (!message)
    return undefined
  const { text, mime } = messageBody(message)
  if (!pretty.value)
    return { text, mime }
  try {
    return { text: formatBody(text, mime), mime }
  }
  catch {
    return { text, mime, error: true }
  }
})

const list = ref<HTMLElement | null>(null)
async function onKey(e: KeyboardEvent): Promise<void> {
  const count = messages.value?.length ?? 0
  if (!count || (e.key !== 'ArrowDown' && e.key !== 'ArrowUp'))
    return
  e.preventDefault()
  const index = selectedIndex.value ?? -1
  selectedIndex.value = e.key === 'ArrowDown'
    ? (index === -1 ? 0 : Math.min(index + 1, count - 1))
    : (index === -1 ? count - 1 : Math.max(index - 1, 0))
  await nextTick()
  list.value?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
}
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col">
    <div v-if="!messages" class="p-3 text-muted-foreground">
      Loading…
    </div>
    <div v-else-if="!messages.length" class="p-3 text-muted-foreground">
      No messages captured
    </div>
    <template v-else>
      <div
        ref="list"
        data-testid="ws-messages"
        tabindex="0"
        aria-label="WebSocket messages"
        :class="cn('min-h-0 overflow-auto font-mono outline-none', selected ? 'h-1/2 shrink-0 border-b border-border' : 'flex-1')"
        @keydown="onKey"
      >
        <div
          v-for="message in messages"
          :key="message.index"
          data-testid="ws-message"
          :data-selected="selectedIndex === message.index || undefined"
          :class="cn(
            'grid cursor-pointer grid-cols-[16px_minmax(0,1fr)_auto_auto_auto] items-center gap-3 border-b border-border/40 px-2 py-1',
            selectedIndex === message.index ? 'bg-signal/10' : message.type === 'send' ? 'bg-pass/5 hover:bg-pass/10' : 'hover:bg-muted/40',
          )"
          @click="selectedIndex = message.index"
        >
          <ArrowUp v-if="message.type === 'send'" class="size-3.5 text-pass" aria-label="Sent" />
          <ArrowDown v-else class="size-3.5 text-fail" aria-label="Received" />
          <span class="truncate text-foreground/90" :title="messagePreview(message, formatSize)">{{ messagePreview(message, formatSize) }}</span>
          <span class="text-muted-foreground" :title="`Opcode ${message.opcode}`">{{ opcodeName(message.opcode) }}</span>
          <span class="text-right text-muted-foreground tabular-nums" :title="`${message.byteLength} bytes`">{{ formatSize(message.byteLength) }}</span>
          <span class="w-14 text-right text-muted-foreground tabular-nums">{{ message.time > 0 && baseTime !== undefined ? formatMs(message.time - baseTime) : '-' }}</span>
        </div>
      </div>
      <div v-if="selected && body" data-testid="ws-message-detail" class="flex min-h-0 flex-1 flex-col p-2">
        <div class="flex items-center gap-1 px-1 pb-1">
          <span class="text-foreground/90">{{ selected.type === 'send' ? 'Sent' : 'Received' }} · {{ opcodeName(selected.opcode) }} · {{ formatSize(selected.byteLength) }}</span>
          <span v-if="body.error" class="text-[11px] text-fail">Formatting failed</span>
          <button
            type="button"
            title="Pretty print"
            :aria-pressed="pretty"
            :class="cn('ml-auto flex size-6 items-center justify-center rounded transition-colors hover:bg-muted', pretty ? 'text-signal' : 'text-muted-foreground')"
            @click="pretty = !pretty"
          >
            <Braces class="size-3.5" />
          </button>
        </div>
        <div class="min-h-0 flex-1 overflow-hidden rounded border border-border">
          <CodeView :code="body.text" :lang="bodyLang(body.mime)" />
        </div>
      </div>
    </template>
  </div>
</template>
