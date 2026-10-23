<script setup lang="ts">
import type { AriaTokenKind } from '../lib/aria'
import { Check, Copy } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { ariaLineTokens, ariaSnapshotText } from '../lib/aria'

const props = defineProps<{
  callId?: string
  file?: string
  phase?: string
  terms?: string[]
  url?: string
}>()

const text = ref('')
const loading = ref(false)
const copied = ref(false)

const visibleTerms = computed(() => (props.terms ?? [])
  .map(term => term.trim())
  .filter(term => term.length >= 2 && text.value.toLowerCase().includes(term.toLowerCase())))

interface AriaPart { highlight: boolean, kind?: AriaTokenKind, text: string }

const lines = computed<AriaPart[][]>(() => {
  const pattern = visibleTerms.value.length
    ? new RegExp(`(${visibleTerms.value.map(escapeRegex).join('|')})`, 'gi')
    : undefined
  return text.value.split('\n').map(line => ariaLineTokens(line).flatMap((token): AriaPart[] => {
    if (!pattern)
      return [{ highlight: false, kind: token.kind, text: token.text }]
    return token.text.split(pattern).filter(Boolean).map(part => ({
      highlight: visibleTerms.value.some(term => term.toLowerCase() === part.toLowerCase()),
      kind: token.kind,
      text: part,
    }))
  }))
})

const kindClass: Record<AriaTokenKind, string> = {
  attribute: 'text-(--code-attribute)',
  role: 'text-(--code-tag)',
  string: 'text-(--code-string)',
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function copySnapshot(): Promise<void> {
  if (!text.value)
    return
  await navigator.clipboard.writeText(text.value)
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

watch(() => props.url, async (url) => {
  text.value = ''
  copied.value = false
  if (!url)
    return
  loading.value = true
  try {
    const res = await fetch(url)
    text.value = res.ok ? ariaSnapshotText(await res.text()).trimEnd() : ''
  }
  catch {
    text.value = ''
  }
  finally {
    loading.value = false
  }
}, { immediate: true })
</script>

<template>
  <div class="absolute inset-0 flex flex-col bg-background text-foreground">
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
      <span class="font-semibold text-foreground">ARIA snapshot</span>
      <span v-if="phase" class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{{ phase }}</span>
      <span v-if="callId" class="font-mono text-[10px] text-muted-foreground">{{ callId }}</span>
      <span v-if="file" class="min-w-0 truncate font-mono text-[10px] text-muted-foreground">{{ file }}</span>
      <button
        type="button"
        class="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
        :disabled="!text"
        @click="copySnapshot"
      >
        <component :is="copied ? Check : Copy" class="size-3" />
        {{ copied ? 'Copied' : 'Copy ARIA' }}
      </button>
    </div>

    <div class="min-h-0 flex-1 overflow-auto p-4">
      <div v-if="loading" class="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading ARIA snapshot…
      </div>
      <pre v-else-if="text" data-testid="aria-snapshot" class="font-mono text-xs leading-relaxed whitespace-pre-wrap"><div v-for="(line, i) in lines" :key="i"><template v-for="(part, j) in line" :key="j"><mark v-if="part.highlight" class="rounded bg-signal/20 px-0.5" :class="[part.kind ? kindClass[part.kind] : 'text-foreground']">{{ part.text }}</mark><span v-else-if="part.kind" :class="kindClass[part.kind]">{{ part.text }}</span><template v-else>{{ part.text }}</template></template></div></pre>
      <div v-else class="flex h-full items-center justify-center text-sm text-muted-foreground">
        No ARIA snapshot captured for this phase
      </div>
    </div>
  </div>
</template>
