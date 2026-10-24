<script setup lang="ts">
import type { AriaBox, AriaLine, AriaTokenKind } from '../lib/aria'
import { Check, Copy } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { ariaLineTokens, ariaSnapshotLines } from '../lib/aria'
import { copyText } from '../lib/clipboard'

const props = defineProps<{
  box?: AriaBox
  callId?: string
  file?: string
  phase?: string
  point?: { x: number, y: number }
  screenshotUrl?: string
  terms?: string[]
  url?: string
}>()

const ariaLines = ref<AriaLine[]>([])
const loading = ref(false)
const copied = ref(false)
const hoveredBox = ref<AriaBox>()
const text = computed(() => ariaLines.value.map(line => line.text).join('\n'))

const visibleTerms = computed(() => (props.terms ?? [])
  .map(term => term.trim())
  .filter(term => term.length >= 2 && text.value.toLowerCase().includes(term.toLowerCase())))

interface AriaPart { highlight: boolean, kind?: AriaTokenKind, text: string }

const lines = computed(() => {
  const pattern = visibleTerms.value.length
    ? new RegExp(`(${visibleTerms.value.map(escapeRegex).join('|')})`, 'gi')
    : undefined
  return ariaLines.value.map(line => ({
    box: line.box,
    parts: ariaLineTokens(line.text).flatMap((token): AriaPart[] => {
      if (!pattern)
        return [{ highlight: false, kind: token.kind, text: token.text }]
      return token.text.split(pattern).filter(Boolean).map(part => ({
        highlight: visibleTerms.value.some(term => term.toLowerCase() === part.toLowerCase()),
        kind: token.kind,
        text: part,
      }))
    }),
  }))
})

const kindClass: Record<AriaTokenKind, string> = {
  attribute: 'text-(--code-attribute)',
  role: 'text-(--code-tag)',
  string: 'text-(--code-string)',
}

function partClass(part: AriaPart): string | undefined {
  const color = part.kind && kindClass[part.kind]
  return part.highlight ? `rounded bg-signal/20 px-0.5 ${color ?? 'text-foreground'}` : color
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

async function copySnapshot(): Promise<void> {
  if (!text.value)
    return
  if (!await copyText(text.value))
    return
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

watch(() => props.url, async (url, _, onCleanup) => {
  let stale = false
  onCleanup(() => (stale = true))
  ariaLines.value = []
  hoveredBox.value = undefined
  copied.value = false
  loading.value = !!url
  if (!url)
    return
  let lines: typeof ariaLines.value = []
  try {
    const res = await fetch(url)
    lines = res.ok ? ariaSnapshotLines(await res.text()) : []
  }
  catch {}
  // Stepping quickly: an earlier action's snapshot must not replace the current one.
  if (stale)
    return
  ariaLines.value = lines
  loading.value = false
}, { immediate: true })

const PADDING = 10
const pane = ref<HTMLElement | null>(null)
const { width: paneWidth, height: paneHeight } = useElementSize(pane)
const naturalSize = ref<{ width: number, height: number }>()
watch(() => props.screenshotUrl, () => (naturalSize.value = undefined))

function onScreenshotLoad(event: Event): void {
  const img = event.target as HTMLImageElement
  naturalSize.value = { width: img.naturalWidth, height: img.naturalHeight }
}

// Screenshots are taken at css scale, so boxes are in image pixels: scale them like the fitted image.
const overlay = computed(() => {
  const size = naturalSize.value
  if (!size || !paneWidth.value || !paneHeight.value)
    return undefined
  const scale = Math.min(paneWidth.value / size.width, paneHeight.value / size.height, 1)
  const left = PADDING + (paneWidth.value - size.width * scale) / 2
  const top = PADDING + (paneHeight.value - size.height * scale) / 2
  const boxStyle = (b: AriaBox): Record<string, string> => ({
    height: `${b.height * scale}px`,
    left: `${left + b.x * scale}px`,
    top: `${top + b.y * scale}px`,
    width: `${b.width * scale}px`,
  })
  return {
    action: props.box && boxStyle(props.box),
    hovered: hoveredBox.value && boxStyle(hoveredBox.value),
    point: props.point && {
      height: `${20 * scale}px`,
      left: `${left + props.point.x * scale}px`,
      top: `${top + props.point.y * scale}px`,
      width: `${20 * scale}px`,
    },
  }
})
</script>

<template>
  <div class="absolute inset-0 flex flex-col bg-background text-foreground">
    <div class="flex h-9 shrink-0 items-center gap-2 border-b border-border px-3 text-xs">
      <span class="font-semibold text-foreground">ARIA snapshot</span>
      <span v-if="phase" data-testid="aria-phase" class="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{{ phase }}</span>
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

    <div v-if="!screenshotUrl && !url" class="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
      No ARIA snapshot captured for this phase
    </div>
    <div v-else class="flex min-h-0 flex-1">
      <div
        ref="pane"
        data-testid="aria-screenshot-pane"
        class="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden bg-muted/30 p-2.5"
      >
        <img
          v-if="screenshotUrl"
          data-testid="aria-screenshot"
          :src="screenshotUrl"
          alt="Screenshot"
          class="max-h-full max-w-full object-contain shadow-lg"
          @load="onScreenshotLoad"
        >
        <span v-else class="text-sm text-muted-foreground">No screenshot</span>
        <template v-if="overlay">
          <div v-if="overlay.action" data-testid="aria-action-box" class="pointer-events-none absolute bg-fail/10 outline outline-fail" :style="overlay.action" />
          <div v-if="overlay.point" data-testid="aria-action-point" class="pointer-events-none absolute -translate-1/2 rounded-full bg-fail" :style="overlay.point" />
          <div v-if="overlay.hovered" data-testid="aria-hovered-box" class="pointer-events-none absolute bg-info/40 outline outline-info" :style="overlay.hovered" />
        </template>
      </div>

      <div class="min-w-0 flex-1 overflow-auto border-l border-border py-2" @mouseleave="hoveredBox = undefined">
        <div v-if="loading" class="flex h-full items-center justify-center text-sm text-muted-foreground">
          Loading ARIA snapshot…
        </div>
        <div v-else-if="text" data-testid="aria-snapshot" class="font-mono text-xs leading-[18px]">
          <div
            v-for="(line, i) in lines"
            :key="i"
            data-testid="aria-line"
            class="px-3 whitespace-pre" :class="[line.box && 'hover:bg-muted']"
            @mouseenter="hoveredBox = line.box"
          >
            <span v-for="(part, j) in line.parts" :key="j" :class="partClass(part)">{{ part.text }}</span>
          </div>
        </div>
        <div v-else class="flex h-full items-center justify-center text-sm text-muted-foreground">
          No ARIA snapshot captured for this phase
        </div>
      </div>
    </div>
  </div>
</template>
