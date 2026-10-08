<script setup lang="ts">
import type { TestPoint } from '@kinora/core'
import { pwStatusMeta } from '@kinora/core'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@kinora/ui/tooltip'
import { useResizeObserver } from '@vueuse/core'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { formatDateTime } from '@/lib/format'

// `slots`: render a fixed number of equal cells (recent on the right, empty slots padding the left)
// so every row lines up. Omit it for the full adaptive timeline (detail view).
const props = withDefaults(
  defineProps<{ points: TestPoint[], projectId: string, height?: number, link?: boolean, q?: string, slots?: number }>(),
  { height: 20, link: true },
)

// Adaptive mode only: render the most recent points that fit the column (cells are min 3px + 3px gap),
// hard-capped at MAX_CELLS so a long history never mounts hundreds of cells/tooltips. This only bounds
// what's DISPLAYED; rate/aggregate calcs read the full points elsewhere.
const CELL_PX = 6
const MAX_CELLS = 150
const root = ref<HTMLElement>()
const maxCells = ref(MAX_CELLS)
useResizeObserver(root, ([entry]) => {
  maxCells.value = Math.min(MAX_CELLS, Math.max(1, Math.floor(entry.contentRect.width / CELL_PX)))
})

const cells = computed(() => {
  const limit = props.slots ?? maxCells.value
  return props.points.slice(-limit).map(p => ({
    point: p,
    meta: pwStatusMeta[p.status],
    date: formatDateTime(p.startedAt),
  }))
})

// In slots mode, fill the unused leading slots with empty placeholders so all rows are the same width.
const padCount = computed(() => (props.slots ? Math.max(0, props.slots - cells.value.length) : 0))

// Slots mode uses fixed-width cells so every cell is identical (flex-1 sub-pixel rounds unevenly across
// a non-divisible width); adaptive mode flex-fills the column.
const cellClass = computed(() => (props.slots ? 'w-1.5 shrink-0' : 'min-w-[3px] flex-1'))
const containerClass = computed(() => (props.slots ? 'justify-end gap-[2px]' : 'gap-[3px]'))
</script>

<template>
  <TooltipProvider :delay-duration="80">
    <div ref="root" class="flex items-stretch overflow-hidden" :class="containerClass" :style="{ height: `${height}px` }">
      <span
        v-for="i in padCount"
        :key="`pad-${i}`"
        class="rounded-[2px] bg-muted/40"
        :class="cellClass"
      />
      <Tooltip v-for="c in cells" :key="c.point.runId">
        <TooltipTrigger as-child>
          <component
            :is="link ? RouterLink : 'div'"
            :to="link ? { name: 'run', params: { projectId, runId: c.point.runId }, query: q ? { q } : undefined } : undefined"
            class="group flex items-stretch"
            :class="cellClass"
          >
            <span
              class="w-full rounded-[2px] opacity-85 transition-all duration-150 group-hover:opacity-100"
              :class="c.meta.cell"
            />
          </component>
        </TooltipTrigger>
        <TooltipContent class="font-mono text-xs">
          <div class="font-semibold">
            {{ c.date }}
          </div>
          <div class="mt-0.5" :class="c.meta.text">
            {{ c.meta.label }}
          </div>
          <div v-if="c.point.retries" class="text-background/70">
            {{ c.point.retries }} retry
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
</template>
