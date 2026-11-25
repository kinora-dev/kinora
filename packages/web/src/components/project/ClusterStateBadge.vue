<script setup lang="ts">
import type { FailureCluster } from '@kinora/core'
import { clusterState, isSnoozed } from '@kinora/core'
import { Badge } from '@kinora/ui/badge'
import { computed } from 'vue'
import { initialOf, STATE_TONE, stateLabel } from '@/lib/cluster-triage'

// Where a cluster stands, plus its snooze and assignee. A plain untriaged failure shows nothing
// unless `always`, since every cluster of a failure list fails.
const props = defineProps<{ cluster: Pick<FailureCluster, 'lastSeen' | 'quietRuns' | 'triage'>, always?: boolean }>()

const state = computed(() => clusterState(props.cluster))
const snoozed = computed(() => isSnoozed(props.cluster))
const assignee = computed(() => props.cluster.triage?.assignee)
</script>

<template>
  <span class="inline-flex shrink-0 items-center gap-1.5">
    <Badge
      v-if="always || state !== 'failing'"
      :data-state="state"
      class="text-[10px]"
      :class="STATE_TONE[state]"
    >
      {{ stateLabel(cluster) }}
    </Badge>
    <Badge v-if="snoozed" class="border-border bg-muted text-[10px] text-muted-foreground">
      Snoozed
    </Badge>
    <span
      v-if="assignee"
      class="flex size-5 items-center justify-center rounded-full bg-signal/15 font-mono text-[10px] font-semibold text-signal"
      :title="`Assigned to ${assignee.name}`"
      :aria-label="`Assigned to ${assignee.name}`"
    >
      {{ initialOf(assignee.name) }}
    </span>
  </span>
</template>
