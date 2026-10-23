<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { useElementSize } from '@vueuse/core'
import { computed, onMounted, ref, watch } from 'vue'

const props = defineProps<{
  // Actual size scrolls the page at 100% instead of shrinking it to fit the panel.
  actualSize?: boolean
  src: string
  viewport?: { width: number, height: number }
}>()

const emit = defineEmits<{
  loaded: [iframe: HTMLIFrameElement]
}>()

// Two iframes take turns: the next snapshot loads in the hidden one, so switching actions
// never flashes a blank page (upstream does the same).
const frames = [ref<HTMLIFrameElement | null>(null), ref<HTMLIFrameElement | null>(null)]
const visible = ref(0)
let iteration = 0

function load(iframe: HTMLIFrameElement, url: string): Promise<void> {
  return new Promise((resolve) => {
    iframe.addEventListener('load', () => resolve(), { once: true })
    iframe.addEventListener('error', () => resolve(), { once: true })
    // `replace` keeps snapshot loads out of the page history.
    if (iframe.contentWindow)
      iframe.contentWindow.location.replace(url)
    else
      iframe.src = url
  })
}

async function show(url: string): Promise<void> {
  const current = ++iteration
  const next = 1 - visible.value
  const iframe = frames[next].value
  if (!iframe)
    return
  await load(iframe, url)
  if (current !== iteration)
    return
  visible.value = next
  emit('loaded', iframe)
}

onMounted(() => void show(props.src))
watch(() => props.src, url => void show(url))

const container = ref<HTMLElement | null>(null)
const { width, height } = useElementSize(container)

// Render at the recorded viewport, shrunk to fit, so responsive pages look as they did in the test.
const stage = computed<CSSProperties>(() => {
  const vp = props.viewport
  if (vp?.width && vp.height && props.actualSize)
    return { height: `${vp.height}px`, margin: '0 auto', position: 'relative', width: `${vp.width}px` }
  if (!vp?.width || !vp.height || !width.value || !height.value)
    return { inset: '0', position: 'absolute' }
  const scale = Math.min(width.value / vp.width, height.value / vp.height, 1)
  return {
    height: `${vp.height}px`,
    left: `${(width.value - vp.width * scale) / 2}px`,
    position: 'absolute',
    top: '0',
    transform: `scale(${scale})`,
    transformOrigin: 'top left',
    width: `${vp.width}px`,
  }
})
</script>

<template>
  <div ref="container" data-testid="snapshot-container" class="absolute inset-0" :class="[actualSize ? 'overflow-auto' : 'overflow-hidden']">
    <div data-testid="snapshot-stage" class="bg-white" :style="stage">
      <iframe
        v-for="(frame, i) in frames"
        :key="i"
        :ref="el => (frame.value = el as HTMLIFrameElement | null)"
        :name="visible === i ? 'snapshot' : 'snapshot-next'"
        title="DOM snapshot"
        sandbox="allow-same-origin allow-scripts"
        :aria-hidden="visible !== i"
        class="absolute inset-0 size-full border-0" :class="[visible !== i && 'invisible pointer-events-none']"
      />
    </div>
  </div>
</template>
