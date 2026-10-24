<script setup lang="ts">
import { cn } from '@kinora/ui'
import { useElementSize } from '@vueuse/core'
import { computed, reactive, ref } from 'vue'

const props = defineProps<{
  name: string
  expected?: string
  actual?: string
  diff?: string
}>()

type Mode = 'diff' | 'actual' | 'expected' | 'sxs' | 'slider'
const mode = ref<Mode>(props.diff ? 'diff' : 'actual')

const tabs = computed(() => {
  const t: { id: Mode, label: string }[] = []
  if (props.diff)
    t.push({ id: 'diff', label: 'Diff' })
  t.push({ id: 'actual', label: 'Actual' }, { id: 'expected', label: 'Expected' })
  if (props.expected && props.actual)
    t.push({ id: 'sxs', label: 'Side by side' }, { id: 'slider', label: 'Slider' })
  return t
})

// Natural sizes, shown under each image like upstream: a size mismatch is a common cause of a diff.
const sizes = reactive<Record<string, string>>({})
function measure(e: Event): void {
  const img = e.target as HTMLImageElement
  sizes[img.src] = `${img.naturalWidth} × ${img.naturalHeight}`
}
function sizeOf(src: string | undefined): string {
  return (src && sizes[new URL(src, location.href).href]) || ''
}

// Side by side, clicking the actual image swaps it for the diff (upstream).
const sxsShowsDiff = ref(false)
const sxsRight = computed(() => sxsShowsDiff.value && props.diff ? props.diff : props.actual)

const wrap = ref<HTMLElement | null>(null)
const { width } = useElementSize(wrap)
const sliderPct = ref(50)
let dragging = false

function moveTo(e: PointerEvent): void {
  const el = wrap.value
  if (!el)
    return
  const r = el.getBoundingClientRect()
  sliderPct.value = Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100))
}
function onDown(e: PointerEvent): void {
  dragging = true
  ;(e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId)
  moveTo(e)
}
function onMove(e: PointerEvent): void {
  if (dragging)
    moveTo(e)
}
function onUp(): void {
  dragging = false
}

// Checkerboard so transparent regions of the PNGs stay visible.
const checker = {
  backgroundImage: 'linear-gradient(45deg, #80808020 25%, transparent 25%), linear-gradient(-45deg, #80808020 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #80808020 75%), linear-gradient(-45deg, transparent 75%, #80808020 75%)',
  backgroundSize: '20px 20px',
  backgroundPosition: '0 0, 0 10px, 10px -10px, -10px 0',
}
</script>

<template>
  <div class="flex flex-col">
    <div class="flex flex-wrap gap-1 border-b border-border bg-muted/40 px-2 py-1">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        :class="cn(
          'rounded px-2 py-0.5 text-[11px] transition-colors',
          mode === t.id ? 'bg-signal/15 text-signal' : 'text-muted-foreground hover:text-foreground',
        )"
        @click="mode = t.id"
      >
        {{ t.label }}
      </button>
    </div>

    <div class="flex justify-center p-3">
      <figure v-if="mode === 'diff' || mode === 'actual' || mode === 'expected'" class="flex flex-col items-center gap-1">
        <img
          :src="mode === 'diff' ? diff : mode === 'actual' ? actual : expected"
          :alt="`${name} ${mode}`"
          class="max-w-full rounded border border-border"
          :style="checker"
          @load="measure"
        >
        <figcaption data-testid="image-size" class="font-mono text-[11px] text-muted-foreground">
          {{ sizeOf(mode === 'diff' ? diff : mode === 'actual' ? actual : expected) }}
        </figcaption>
      </figure>

      <div v-else-if="mode === 'sxs'" class="flex flex-wrap items-start justify-center gap-3">
        <figure class="flex flex-col items-center gap-1">
          <img :src="expected" :alt="`${name} expected`" class="max-w-full rounded border border-border" :style="checker" @load="measure">
          <figcaption class="text-[11px] text-muted-foreground">
            Expected <span class="font-mono">{{ sizeOf(expected) }}</span>
          </figcaption>
        </figure>
        <figure class="flex flex-col items-center gap-1">
          <img
            :src="sxsRight"
            :alt="`${name} ${sxsShowsDiff ? 'diff' : 'actual'}`"
            :title="diff ? `Click to show the ${sxsShowsDiff ? 'actual image' : 'diff'}` : undefined"
            :class="cn('max-w-full rounded border border-border', diff && 'cursor-pointer')"
            :style="checker"
            data-testid="sxs-right"
            @load="measure"
            @click="sxsShowsDiff = !sxsShowsDiff"
          >
          <figcaption class="text-[11px] text-muted-foreground">
            {{ sxsShowsDiff && diff ? 'Diff' : 'Actual' }} <span class="font-mono">{{ sizeOf(sxsRight) }}</span>
          </figcaption>
        </figure>
      </div>

      <div
        v-else-if="mode === 'slider'"
        ref="wrap"
        class="relative max-w-full touch-none overflow-hidden rounded border border-border select-none"
        @pointerdown="onDown"
        @pointermove="onMove"
        @pointerup="onUp"
        @pointercancel="onUp"
      >
        <img :src="expected" :alt="`${name} expected`" class="block w-full" :style="checker" draggable="false">
        <div class="absolute inset-y-0 left-0 overflow-hidden" :style="{ width: `${sliderPct}%`, ...checker }">
          <img :src="actual" :alt="`${name} actual`" class="block max-w-none" :style="{ width: `${width}px` }" draggable="false">
        </div>
        <div class="absolute inset-y-0 -ml-px w-0.5 cursor-ew-resize bg-signal" :style="{ left: `${sliderPct}%` }">
          <div class="absolute top-1/2 left-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full border border-signal bg-background" />
        </div>
      </div>
    </div>
    <!-- The three files, each openable on its own (upstream lists them under the diff). -->
    <div class="flex flex-wrap gap-3 border-t border-border px-3 py-1.5 text-[11px]">
      <a
        v-for="file in [{ label: 'expected', url: expected }, { label: 'actual', url: actual }, { label: 'diff', url: diff }].filter(f => f.url)"
        :key="file.label"
        data-testid="image-diff-file"
        :href="file.url"
        target="_blank"
        rel="noreferrer"
        class="font-mono text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      >{{ name }}-{{ file.label }}.png</a>
    </div>
  </div>
</template>
