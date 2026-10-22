<script setup lang="ts">
import { cn } from '@kinora/ui'
import { ChevronLeft, ChevronRight, Pause, Play, ZoomOut } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { computed, ref } from 'vue'
import { actionDuration, actionStatus, actionTitle } from '../lib/action'
import { formatMs } from '../lib/format'
import { filmstripTiles, screencastFrames, xToTime } from '../lib/timeline'
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
      return { duration: formatMs(actionDuration(a)), end, id: item.id, start, status: actionStatus(a), title: actionTitle(a) }
    })
    .filter(s => s.end >= min && s.start <= max)
    .map((s) => {
      const left = ((Math.max(s.start, min) - min) / span) * 100
      const width = Math.max(0.4, ((Math.min(s.end, max) - Math.max(s.start, min)) / span) * 100)
      return { duration: s.duration, end: s.end, id: s.id, left, start: s.start, status: s.status, title: s.title, width }
    })
})

const errorMarkers = computed(() => {
  const { min, max, span } = bounds.value
  return store.items.value
    .filter(item => item.action.error?.message)
    .map((item) => {
      const time = item.action.startTime ?? item.action.endTime ?? min
      return { id: item.id, time, left: ((time - min) / span) * 100, title: actionTitle(item.action) }
    })
    .filter(marker => marker.time >= min && marker.time <= max)
})

const cursor = computed(() => {
  const action = store.selectedAction.value
  const { min, max, span } = bounds.value
  const time = store.playhead.value ?? action?.startTime ?? min
  if (time < min || time > max)
    return undefined
  return {
    left: ((time - min) / span) * 100,
    label: formatMs(time - (store.model.value?.startTime ?? min)),
  }
})

const frames = computed(() => screencastFrames(store.model.value))

const FILMSTRIP_TILE_WIDTH = 58
const filmstrip = ref<HTMLElement | null>(null)
const { width: filmstripWidth } = useElementSize(filmstrip)
const tiles = computed(() => {
  const { min, max } = bounds.value
  const count = Math.max(1, Math.floor(filmstripWidth.value / FILMSTRIP_TILE_WIDTH))
  return filmstripTiles(frames.value, min, max, count).map(tile => ({
    ...tile,
    left: (((tile.time - min) / (max - min)) * 100) - (50 / count),
    width: 100 / count,
  }))
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
function selectNearestAtClientX(clientX: number): void {
  const { x, width } = localX(clientX)
  const { min, span } = bounds.value
  seekToTime(xToTime(x, width, min, span))
}

function onBrushUp(e: PointerEvent): void {
  window.removeEventListener('pointermove', onBrushMove)
  window.removeEventListener('pointerup', onBrushUp)
  const b = brush.value
  brush.value = null
  if (!b)
    return
  if (Math.abs(b.x1 - b.x0) < 4) {
    selectNearestAtClientX(e.clientX)
    return
  }
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

function selectMarker(id: string): void {
  store.select(id)
  store.setHoveredAction(null)
}

const currentTitle = computed(() =>
  store.selectedAction.value ? actionTitle(store.selectedAction.value) : 'No action selected',
)
const position = computed(() => `${store.selectedIndex.value + 1} / ${store.items.value.length}`)
const hoveredDetails = computed(() => {
  const id = store.hoveredActionId.value
  const segment = segments.value.find(segment => segment.id === id)
  if (!segment)
    return null
  return {
    ...segment,
    left: Math.min(86, Math.max(0, segment.left)),
    range: `${formatMs(segment.start - bounds.value.min)} - ${formatMs(segment.end - bounds.value.min)}`,
  }
})
const rangeLabel = computed(() => {
  const range = store.timeRange.value
  const model = store.model.value
  if (!range || !model)
    return ''
  return `${formatMs(range.start - model.startTime)} - ${formatMs(range.end - model.startTime)}`
})
const scrubberValue = computed({
  get: () => Math.max(0, store.selectedIndex.value),
  set: value => store.selectIndex(Number(value)),
})

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
      <button
        type="button"
        data-testid="playback-speed"
        class="flex h-7 w-10 shrink-0 items-center justify-center rounded-md font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        title="Playback speed"
        @click="store.cyclePlaybackSpeed"
      >
        {{ store.playbackSpeed.value }}x
      </button>
      <div data-testid="current-action" class="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
        {{ currentTitle }}
      </div>
      <span v-if="cursor" data-testid="timeline-current-time" class="shrink-0 font-mono text-[11px] text-muted-foreground">
        {{ cursor.label }}
      </span>
      <input
        v-model.number="scrubberValue"
        data-testid="action-scrubber"
        type="range"
        min="0"
        :max="Math.max(0, store.items.value.length - 1)"
        step="1"
        class="h-1 w-32 shrink-0 cursor-pointer appearance-none rounded-full bg-muted accent-signal disabled:opacity-30"
        title="Action scrubber"
        :disabled="store.items.value.length <= 1"
      >
      <button
        v-if="store.timeRange.value"
        type="button"
        data-testid="reset-zoom"
        class="flex shrink-0 items-center gap-1 rounded-md border border-signal/30 bg-signal/10 px-1.5 py-1 text-[11px] text-signal transition-colors hover:bg-signal/15"
        title="Reset zoom"
        @click="store.clearTimeRange"
      >
        <ZoomOut class="size-3.5" /> {{ rangeLabel }}
      </button>
      <div class="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">
        {{ position }}
      </div>
    </div>

    <!-- filmstrip -->
    <div v-if="frames.length" class="relative h-12 shrink-0 border-b border-border bg-muted/10">
      <div ref="filmstrip" class="absolute inset-x-2 inset-y-1.5">
        <div
          v-for="tile in tiles"
          :key="tile.time"
          data-testid="filmstrip-tile"
          class="absolute top-0 h-full px-px"
          :style="{ left: `${tile.left}%`, width: `${tile.width}%` }"
        >
          <img
            :src="tile.frame.url"
            alt=""
            class="size-full cursor-pointer rounded-sm border border-border object-cover object-top transition-transform hover:z-10 hover:scale-110"
            @click="seekToTime(tile.time)"
          >
        </div>
      </div>
    </div>

    <!-- action track (drag to zoom) -->
    <div class="relative h-7 shrink-0 bg-muted/20">
      <div
        ref="trackInner"
        data-testid="timeline-track"
        class="absolute inset-x-2 inset-y-1.5 cursor-crosshair touch-none"
        @pointerdown="onBrushDown"
      >
        <button
          v-for="seg in segments"
          :key="seg.id"
          type="button"
          data-testid="action-segment"
          :class="cn(
            'absolute top-0 h-full rounded-sm transition-all cursor-crosshair',
            statusColor[seg.status],
            (store.selectedId.value === seg.id || store.hoveredActionId.value === seg.id) && 'ring-2 ring-signal ring-offset-1 ring-offset-background z-10',
          )"
          :style="{ left: `${seg.left}%`, width: `${seg.width}%` }"
          :title="`${seg.title} · ${seg.duration}`"
          :aria-label="`${seg.title} ${seg.duration}`"
          @click="selectSegment(seg.id)"
          @dblclick.stop="store.zoomToAction(store.items.value.find(item => item.id === seg.id)!.action)"
          @mouseenter="store.setHoveredAction(seg.id)"
          @mouseleave="store.setHoveredAction(null)"
        />
        <div
          v-if="cursor"
          data-testid="timeline-cursor"
          class="pointer-events-none absolute -top-1 bottom-[-4px] z-20 w-px bg-signal shadow-[0_0_0_1px_color-mix(in_oklch,var(--background)_70%,transparent)]"
          :style="{ left: `${cursor.left}%` }"
        />
        <button
          v-for="marker in errorMarkers"
          :key="`error-${marker.id}`"
          type="button"
          data-testid="timeline-error-marker"
          class="absolute -top-1 bottom-[-4px] z-20 w-1 -translate-x-1/2 rounded-full bg-fail shadow-[0_0_0_2px_color-mix(in_oklch,var(--background)_80%,transparent)] transition-transform hover:scale-x-150"
          :style="{ left: `${marker.left}%` }"
          :title="marker.title"
          @click.stop="selectMarker(marker.id)"
          @mouseenter="store.setHoveredAction(marker.id)"
          @mouseleave="store.setHoveredAction(null)"
        />
        <div
          v-if="hoveredDetails"
          data-testid="timeline-hover-card"
          class="pointer-events-none absolute bottom-full z-30 mb-1 w-56 rounded-md border border-border bg-popover p-2 text-xs shadow-lg"
          :style="{ left: `${hoveredDetails.left}%` }"
        >
          <div class="truncate font-medium text-foreground">
            {{ hoveredDetails.title }}
          </div>
          <div class="mt-1 flex items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span>{{ hoveredDetails.duration }}</span>
            <span>{{ hoveredDetails.range }}</span>
            <span :class="hoveredDetails.status === 'error' ? 'text-fail' : hoveredDetails.status === 'step' ? 'text-muted-foreground' : 'text-pass'">{{ hoveredDetails.status }}</span>
          </div>
        </div>
        <div
          v-if="brush"
          data-testid="timeline-brush"
          class="pointer-events-none absolute inset-y-0 z-30 rounded-sm border-x-2 border-signal bg-signal/25 shadow-[0_0_0_1px_color-mix(in_oklch,var(--signal)_45%,transparent)]"
          :style="brushStyle"
        />
      </div>
    </div>
  </div>
</template>
