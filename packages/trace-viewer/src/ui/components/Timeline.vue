<script setup lang="ts">
import { cn } from '@kinora/ui'
import { ChevronLeft, ChevronRight, Pause, Play, ZoomOut } from '@lucide/vue'
import { computed, ref } from 'vue'
import { actionStatus, actionTitle } from '../lib/action'
import { xToTime } from '../lib/timeline'
import { useTraceStore } from '../store'

const store = useTraceStore()

const bounds = computed(() => {
  const m = store.model.value
  if (!m)
    return { min: 0, max: 1, span: 1 }
  const r = store.timeRange.value
  const min = r ? r.start : m.startTime
  const max = r ? r.end : m.endTime
  return { min, max, span: Math.max(1, max - min) }
})

const segments = computed(() => {
  const { min, max, span } = bounds.value
  return store.items.value
    .map((item) => {
      const a = item.action
      const start = a.startTime ?? min
      const end = a.endTime ?? start
      return { id: item.id, start, end, status: actionStatus(a) }
    })
    .filter(s => s.end >= min && s.start <= max)
    .map((s) => {
      const left = ((Math.max(s.start, min) - min) / span) * 100
      const width = Math.max(0.4, ((Math.min(s.end, max) - Math.max(s.start, min)) / span) * 100)
      return { id: s.id, left, width, status: s.status }
    })
})

const frames = computed(() => {
  const m = store.model.value
  if (!m)
    return []
  const { min, max, span } = bounds.value
  const out: { url: string, left: number, timestamp: number }[] = []
  for (const page of m.pages) {
    for (const f of page.screencastFrames) {
      if (f.timestamp < min || f.timestamp > max)
        continue
      out.push({
        url: m.createRelativeUrl(`file/${f.file}`),
        left: ((f.timestamp - min) / span) * 100,
        timestamp: f.timestamp,
      })
    }
  }
  return out.sort((a, b) => a.timestamp - b.timestamp)
})

// Drag-to-zoom: brush a window on the action track to filter every tab.
const trackInner = ref<HTMLElement | null>(null)
const brush = ref<{ x0: number, x1: number } | null>(null)
let brushed = false

function localX(clientX: number): { x: number, width: number } {
  const rect = trackInner.value!.getBoundingClientRect()
  return { x: clientX - rect.left, width: rect.width }
}
function onBrushDown(e: PointerEvent): void {
  brushed = false
  brush.value = { x0: localX(e.clientX).x, x1: localX(e.clientX).x }
  window.addEventListener('pointermove', onBrushMove)
  window.addEventListener('pointerup', onBrushUp)
}
function onBrushMove(e: PointerEvent): void {
  if (brush.value)
    brush.value = { ...brush.value, x1: localX(e.clientX).x }
}
function onBrushUp(e: PointerEvent): void {
  window.removeEventListener('pointermove', onBrushMove)
  window.removeEventListener('pointerup', onBrushUp)
  const b = brush.value
  brush.value = null
  if (!b || Math.abs(b.x1 - b.x0) < 4)
    return
  brushed = true
  const { width } = localX(e.clientX)
  const { min, span } = bounds.value
  store.setTimeRange(xToTime(b.x0, width, min, span), xToTime(b.x1, width, min, span))
}

function selectSegment(id: string): void {
  if (brushed) {
    brushed = false
    return
  }
  store.select(id)
}

const brushStyle = computed(() => {
  const b = brush.value
  if (!b)
    return {}
  return { left: `${Math.min(b.x0, b.x1)}px`, width: `${Math.abs(b.x1 - b.x0)}px` }
})

const statusColor: Record<string, string> = {
  ok: 'bg-pass/70 hover:bg-pass',
  error: 'bg-fail hover:bg-fail',
  step: 'bg-muted-foreground/40 hover:bg-muted-foreground/70',
}

const currentTitle = computed(() =>
  store.selectedAction.value ? actionTitle(store.selectedAction.value) : 'No action selected',
)
const position = computed(() => `${store.selectedIndex.value + 1} / ${store.items.value.length}`)

// Select the action whose time window is closest to a screencast frame.
function seekToTime(t: number): void {
  let best: string | undefined
  let bestDist = Infinity
  for (const item of store.items.value) {
    const start = item.action.startTime ?? 0
    const dist = Math.abs(start - t)
    if (dist < bestDist) {
      bestDist = dist
      best = item.id
    }
  }
  if (best)
    store.select(best)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b border-border px-3">
      <button
        type="button"
        data-testid="play"
        class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :title="store.playing.value ? 'Pause' : 'Play'"
        @click="store.togglePlay"
      >
        <Pause v-if="store.playing.value" class="size-4" />
        <Play v-else class="size-4" />
      </button>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          :disabled="store.selectedIndex.value <= 0"
          title="Previous action"
          @click="store.step(-1)"
        >
          <ChevronLeft class="size-4" />
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          :disabled="store.selectedIndex.value >= store.items.value.length - 1"
          title="Next action"
          @click="store.step(1)"
        >
          <ChevronRight class="size-4" />
        </button>
      </div>
      <div data-testid="current-action" class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {{ currentTitle }}
      </div>
      <button
        v-if="store.timeRange.value"
        type="button"
        data-testid="reset-zoom"
        class="flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Reset zoom"
        @click="store.clearTimeRange"
      >
        <ZoomOut class="size-3.5" /> Reset
      </button>
      <div class="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {{ position }}
      </div>
    </div>

    <!-- filmstrip -->
    <div v-if="frames.length" class="relative h-12 shrink-0 border-b border-border bg-muted/10">
      <div class="absolute inset-x-2 inset-y-1.5">
        <img
          v-for="(f, i) in frames"
          :key="i"
          :src="f.url"
          class="absolute top-0 h-full w-16 cursor-pointer rounded-sm border border-border object-cover object-top transition-transform hover:z-10 hover:scale-110"
          :style="{ left: `${f.left}%` }"
          @click="seekToTime(f.timestamp)"
        >
      </div>
    </div>

    <!-- action track (drag to zoom) -->
    <div class="relative h-7 shrink-0 bg-muted/20">
      <div
        ref="trackInner"
        class="absolute inset-x-2 inset-y-1.5 cursor-crosshair touch-none"
        @pointerdown="onBrushDown"
      >
        <button
          v-for="seg in segments"
          :key="seg.id"
          type="button"
          :class="cn(
            'absolute top-0 h-full rounded-sm transition-all cursor-crosshair',
            statusColor[seg.status],
            store.selectedId.value === seg.id && 'ring-2 ring-signal ring-offset-1 ring-offset-background z-10',
          )"
          :style="{ left: `${seg.left}%`, width: `${seg.width}%` }"
          @click="selectSegment(seg.id)"
        />
        <div
          v-if="brush"
          class="pointer-events-none absolute inset-y-0 border-x border-signal bg-signal/20"
          :style="brushStyle"
        />
      </div>
    </div>
  </div>
</template>
