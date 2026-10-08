<script setup lang="ts">
import type { ScreenshotComparison } from '@kinora/core'
import { computed, ref } from 'vue'

// The images of one failed screenshot assertion, switchable between the diff, what the test
// got, what the baseline expected, and both side by side. Only the selected view is in the DOM,
// so a run full of visual failures doesn't download every image up front.
const props = defineProps<{ comparison: ScreenshotComparison<{ url?: string }> }>()

type View = 'diff' | 'actual' | 'expected' | 'side-by-side'
const LABELS: Record<View, string> = { 'diff': 'Diff', 'actual': 'Actual', 'expected': 'Expected', 'side-by-side': 'Side by side' }

const urls = computed(() => ({
  diff: props.comparison.diff?.url,
  actual: props.comparison.actual?.url,
  expected: props.comparison.expected?.url,
}))

// A missing baseline has only `actual`; a size mismatch has no `diff`.
const views = computed<View[]>(() => {
  const u = urls.value
  return [
    ...u.diff ? ['diff' as const] : [],
    ...u.actual ? ['actual' as const] : [],
    ...u.expected ? ['expected' as const] : [],
    ...u.actual && u.expected ? ['side-by-side' as const] : [],
  ]
})

const picked = ref<View>()
const view = computed(() => (picked.value && views.value.includes(picked.value) ? picked.value : views.value[0]))

const panes = computed(() => {
  const u = urls.value
  if (view.value === 'side-by-side')
    return [{ label: 'Expected', url: u.expected }, { label: 'Actual', url: u.actual }]
  return view.value ? [{ label: LABELS[view.value], url: u[view.value] }] : []
})
</script>

<template>
  <figure v-if="views.length" :aria-label="`Screenshot ${comparison.name}`" class="overflow-hidden rounded-md border border-border/70 bg-card/80">
    <figcaption class="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
      <span class="truncate font-mono text-[11px] text-muted-foreground">{{ comparison.name }}</span>
      <div class="flex gap-1">
        <button
          v-for="v in views"
          :key="v"
          type="button"
          :aria-pressed="v === view"
          class="rounded px-2 py-0.5 font-mono text-[10px] transition-colors"
          :class="v === view ? 'bg-foreground/10 text-foreground' : 'text-muted-foreground hover:text-foreground'"
          @click="picked = v"
        >
          {{ LABELS[v] }}
        </button>
      </div>
    </figcaption>
    <div class="grid gap-px bg-border/70" :class="panes.length > 1 ? 'sm:grid-cols-2' : ''">
      <a
        v-for="pane in panes"
        :key="pane.label"
        :href="pane.url"
        target="_blank"
        rel="noopener"
        :title="`Open the ${pane.label.toLowerCase()} image`"
        class="flex flex-col items-center gap-2 bg-muted/30 p-3"
      >
        <span v-if="panes.length > 1" class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">{{ pane.label }}</span>
        <img :src="pane.url" :alt="`${pane.label} screenshot of ${comparison.name}`" loading="lazy" class="max-h-96 max-w-full object-contain">
      </a>
    </div>
  </figure>
</template>
