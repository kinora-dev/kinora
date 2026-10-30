<script setup lang="ts">
import type { RunSummary } from '@kinora/core'
import { formatPct, partialRunLabel, passRate, runHealth } from '@kinora/core'
import { computed } from 'vue'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../tooltip'

const props = withDefaults(
  defineProps<{ runs: RunSummary[], limit?: number, height?: number }>(),
  { limit: 30, height: 38 },
)
// Framework-agnostic: callers decide what selecting a run does (navigate, open a trace, ...).
const emit = defineEmits<{ select: [run: RunSummary] }>()

const dateFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' })

const HEALTH_COLORS = { passing: 'bg-pass', flaky: 'bg-flaky', failing: 'bg-fail', empty: 'bg-muted-foreground/40' } as const

function barColor(r: RunSummary, health: keyof typeof HEALTH_COLORS, partial: string | undefined): string {
  // An environment incident is hatched: its failures say nothing about the tests.
  if (r.incident)
    return 'bg-[repeating-linear-gradient(135deg,var(--color-muted-foreground)_0_2px,transparent_2px_4px)] ring-1 ring-inset ring-muted-foreground/50'
  return partial ? 'bg-muted-foreground/40' : HEALTH_COLORS[health]
}

// Chronological, oldest first, capped to the most recent `limit`.
const bars = computed(() =>
  [...props.runs]
    .sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt))
    .slice(-props.limit)
    .map((r) => {
      const health = runHealth(r.counts)
      const partial = partialRunLabel(r)
      return {
        run: r,
        health,
        partial,
        pct: passRate(r.counts),
        color: barColor(r, health, partial),
        date: dateFmt.format(new Date(r.startedAt)),
      }
    }),
)
</script>

<template>
  <TooltipProvider :delay-duration="80">
    <div class="flex items-end gap-[3px]" :style="{ height: `${height}px` }">
      <Tooltip v-for="b in bars" :key="b.run.runId">
        <TooltipTrigger as-child>
          <button type="button" class="group relative flex h-full flex-1 items-end" @click="emit('select', b.run)">
            <span
              class="w-full rounded-[2px] opacity-80 transition-all duration-150 group-hover:opacity-100 group-hover:ring-2 group-hover:ring-offset-1 group-hover:ring-offset-background"
              :class="[b.color, b.health === 'passing' ? 'group-hover:ring-pass/40' : b.health === 'flaky' ? 'group-hover:ring-flaky/40' : 'group-hover:ring-fail/40']"
              :style="{ height: `${Math.max(12, b.pct * 100)}%` }"
            />
          </button>
        </TooltipTrigger>
        <TooltipContent class="font-mono text-xs">
          <div class="font-semibold">
            {{ b.date }}
          </div>
          <div class="mt-0.5 tabular-nums text-background/70">
            {{ formatPct(b.pct) }} pass
          </div>
          <div class="tabular-nums text-background/70">
            {{ b.run.counts.unexpected }} fail / {{ b.run.counts.flaky }} flaky
          </div>
          <div v-if="b.partial" class="tabular-nums text-background/70">
            {{ b.partial }}
          </div>
          <div v-if="b.run.incident" class="text-background/70">
            Environment incident, not counted
          </div>
        </TooltipContent>
      </Tooltip>
    </div>
  </TooltipProvider>
</template>
