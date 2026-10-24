<script setup lang="ts">
import { cn } from '@kinora/ui'
import { ChevronLeft, ChevronRight, Pause, Play, Square, ZoomOut } from '@lucide/vue'
import { useElementSize } from '@vueuse/core'
import { computed, onBeforeUnmount, ref } from 'vue'
import { actionDuration, actionStatus, actionTitle } from '../lib/action'
import { formatMs } from '../lib/format'
import { filmstripTiles, frameAt, pageScreencastFrames, rulerTicks, xToTime } from '../lib/timeline'
import { useTraceStore } from '../store'

const store = useTraceStore()

const bounds = computed(() => {
  const m = store.model.value
  if (!m)
    return { min: 0, max: 1, span: 1 }
  const r = store.timeRange.value
  const min = r ? r.start : m.startTime
  // Unzoomed, leave 5% free on the right so the last actions don't touch the edge (upstream).
  const max = r ? r.end : m.endTime + (m.endTime - m.startTime) / 20
  return { min, max, span: Math.max(1, max - min) }
})

const segments = computed(() => {
  const { min, max, span } = bounds.value
  return store.items.value
    .map((item) => {
      const a = item.action
      const start = a.startTime ?? min
      // Unfinished actions (`endTime: 0`, e.g. the one a test timed out in) run to the trace end.
      const end = a.endTime || store.model.value?.endTime || start
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

const pages = computed(() => pageScreencastFrames(store.model.value))

const FILMSTRIP_TILE_WIDTH = 58
const filmstrip = ref<HTMLElement | null>(null)
const { width: filmstripWidth } = useElementSize(filmstrip)
const rows = computed(() => {
  const { min, max } = bounds.value
  const count = Math.max(1, Math.floor(filmstripWidth.value / FILMSTRIP_TILE_WIDTH))
  return pages.value.map(page => ({
    pageId: page.pageId,
    frames: page.frames,
    tiles: filmstripTiles(page.frames, min, max, count).map(tile => ({
      ...tile,
      left: (((tile.time - min) / (max - min)) * 100) - (50 / count),
      width: 100 / count,
    })),
  }))
})

// Large preview of the frame under the pointer, like upstream's film strip.
const PREVIEW_WIDTH = 320
const preview = ref<{ url: string, x: number, top: number } | null>(null)
function onFilmstripMove(e: MouseEvent, frames: { url: string, timestamp: number }[]): void {
  const strip = filmstrip.value
  if (!strip)
    return
  const rect = strip.getBoundingClientRect()
  const x = e.clientX - rect.left
  const { min, span } = bounds.value
  const frame = frameAt(frames, xToTime(x, rect.width, min, span))
  const row = (e.currentTarget as HTMLElement).getBoundingClientRect()
  preview.value = frame ? { url: frame.url, x: Math.min(Math.max(x, PREVIEW_WIDTH / 2), rect.width - PREVIEW_WIDTH / 2), top: row.bottom - rect.top } : null
}

const track = ref<HTMLElement | null>(null)
const { width: trackWidth } = useElementSize(track)
const ticks = computed(() => rulerTicks(bounds.value.min, bounds.value.max, trackWidth.value, store.model.value?.startTime ?? bounds.value.min))

const highlight = computed(() => {
  const range = store.highlightedTime.value
  const { min, max, span } = bounds.value
  if (!range || range.end < min || range.start > max)
    return undefined
  const start = Math.max(range.start, min)
  return { left: ((start - min) / span) * 100, width: ((Math.min(range.end, max) - start) / span) * 100 }
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

function removeBrushListeners(): void {
  window.removeEventListener('pointermove', onBrushMove)
  window.removeEventListener('pointerup', onBrushUp)
}
onBeforeUnmount(removeBrushListeners)

function onBrushUp(e: PointerEvent): void {
  removeBrushListeners()
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
// The scrubber works in ms from the trace start, over the zoomed window when there is one.
const scrubber = computed(() => {
  const model = store.model.value
  const origin = model?.startTime ?? 0
  const range = store.timeRange.value
  const min = (range?.start ?? origin) - origin
  const max = (range?.end ?? model?.endTime ?? origin) - origin
  const span = Math.max(1, max - min)
  const marks = store.items.value
    .map(item => item.action.startTime - origin)
    .filter(t => t >= min && t <= max)
    .map(t => ((t - min) / span) * 100)
  return { max, min, marks }
})
const scrubberValue = computed({
  get: () => {
    const origin = store.model.value?.startTime ?? 0
    return (store.playhead.value ?? store.selectedAction.value?.startTime ?? origin) - origin
  },
  set: value => store.scrubTo((store.model.value?.startTime ?? 0) + Number(value)),
})

// Select what was running at that time, never an action that had not started yet (upstream).
function seekToTime(t: number): void {
  store.selectAtTime(t)
}
</script>

<template>
  <div data-timeline class="flex h-full flex-col">
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
      <button
        type="button"
        data-testid="stop"
        class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
        title="Stop"
        :disabled="!store.playing.value && store.playhead.value === null"
        @click="store.stopPlay"
      >
        <Square class="size-3.5" />
      </button>
      <div class="flex items-center gap-0.5">
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          :disabled="!store.canStep(-1)"
          title="Previous action"
          @click="store.step(-1)"
        >
          <ChevronLeft class="size-4" />
        </button>
        <button
          type="button"
          class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
          :disabled="!store.canStep(1)"
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
      <div class="relative flex w-40 shrink-0 items-center">
        <span
          v-for="(mark, i) in scrubber.marks"
          :key="i"
          data-testid="scrubber-mark"
          class="pointer-events-none absolute top-1/2 h-2.5 w-px -translate-y-1/2 bg-muted-foreground/40"
          :style="{ left: `${mark}%` }"
        />
        <input
          v-model.number="scrubberValue"
          data-testid="action-scrubber"
          type="range"
          :min="scrubber.min"
          :max="scrubber.max"
          step="1"
          class="relative h-1 w-full cursor-pointer appearance-none rounded-full bg-muted/70 accent-signal disabled:opacity-30"
          title="Scrub through the trace"
          :disabled="!store.items.value.length"
        >
      </div>
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

    <!-- filmstrip: one row per page -->
    <div v-if="rows.length" class="relative shrink-0 border-b border-border bg-muted/10 px-2 py-1.5" @mouseleave="preview = null">
      <div ref="filmstrip" class="relative flex flex-col gap-1">
        <div
          v-for="row in rows"
          :key="row.pageId"
          data-testid="filmstrip-row"
          class="relative h-9"
          @mousemove="onFilmstripMove($event, row.frames)"
        >
          <div
            v-for="tile in row.tiles"
            :key="tile.time"
            data-testid="filmstrip-tile"
            class="absolute top-0 h-full px-px"
            :style="{ left: `${tile.left}%`, width: `${tile.width}%` }"
          >
            <img
              :src="tile.frame.url"
              alt=""
              class="size-full cursor-pointer rounded-sm border border-border object-cover object-top"
              @click="seekToTime(tile.time)"
            >
          </div>
        </div>
        <img
          v-if="preview"
          data-testid="filmstrip-preview"
          :src="preview.url"
          alt=""
          class="pointer-events-none absolute z-40 mt-1 -translate-x-1/2 rounded-md border border-border bg-background shadow-xl"
          :style="{ left: `${preview.x}px`, top: `${preview.top}px`, width: `${PREVIEW_WIDTH}px` }"
        >
      </div>
    </div>

    <!-- ruler -->
    <div class="relative h-4 shrink-0 bg-muted/20">
      <div ref="track" class="absolute inset-x-2 inset-y-0">
        <div
          v-for="tick in ticks"
          :key="tick.time"
          data-testid="ruler-tick"
          class="absolute bottom-0 h-full border-l border-border/80 pl-1 font-mono text-[9px] leading-4 text-muted-foreground/80"
          :style="{ left: `${tick.left}%` }"
        >
          {{ tick.label }}
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
          v-if="highlight"
          data-testid="timeline-highlight"
          class="pointer-events-none absolute -inset-y-1 z-10 min-w-0.5 rounded-sm bg-info/30 ring-1 ring-info"
          :style="{ left: `${highlight.left}%`, width: `${highlight.width}%` }"
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
