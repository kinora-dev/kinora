<script setup lang="ts">
import type { RunSummary } from '@kinora/core'
import { partialRunLabel, runHealth } from '@kinora/core'
import { HealthBadge } from '@kinora/ui/health-badge'
import { computed } from 'vue'

// A run's health, or how many of its shards landed while it misses some (its counts are partial).
// An environment incident reads as such: its failures say nothing about the tests.
const props = defineProps<{ run: Pick<RunSummary, 'counts' | 'status' | 'shardProgress' | 'incident'> }>()

const partial = computed(() => partialRunLabel(props.run))
</script>

<template>
  <span
    v-if="run.incident || partial"
    :data-health="run.incident ? 'incident' : 'partial'"
    :title="run.incident?.reason"
    class="inline-flex items-center gap-1.5 rounded-full bg-background px-2 py-1 font-mono text-[10px] font-medium leading-none tracking-wider whitespace-nowrap text-muted-foreground uppercase ring-1 ring-border"
  >
    <span class="size-1.5 rounded-full border border-muted-foreground" />
    {{ run.incident ? 'Incident' : partial }}
  </span>
  <HealthBadge v-else :health="runHealth(run.counts)" />
</template>
