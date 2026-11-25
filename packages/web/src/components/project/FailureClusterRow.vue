<script setup lang="ts">
import type { FailureCluster } from '@kinora/core'
import type { TriageChange } from '@/composables/useClusterTriage'
import { clusterState } from '@kinora/core'
import { Badge } from '@kinora/ui/badge'
import { ChevronDown, ChevronRight, ExternalLink } from '@lucide/vue'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import CopyButton from '@/components/app/CopyButton.vue'
import ClusterStateBadge from '@/components/project/ClusterStateBadge.vue'
import ClusterTriageActions from '@/components/project/ClusterTriageActions.vue'
import { ago } from '@/lib/cluster-triage'
import { formatDateTime } from '@/lib/format'

const props = defineProps<{
  cluster: FailureCluster
  projectId: string
  labels: Map<string, string>
  expanded: boolean
  saving: boolean
  disabled: boolean
}>()

const emit = defineEmits<{ toggle: [], save: [change: TriageChange, message: string] }>()

const settled = computed(() => ['resolved', 'ignored'].includes(clusterState(props.cluster)))
</script>

<template>
  <div
    :id="`cluster-${cluster.fingerprint}`"
    data-testid="failure-cluster"
    class="scroll-mt-20 rounded-lg border border-border/60 bg-background/40"
  >
    <button
      type="button"
      class="flex w-full items-center gap-3 px-3 py-2.5 text-left"
      :aria-expanded="expanded"
      @click="emit('toggle')"
    >
      <component :is="expanded ? ChevronDown : ChevronRight" class="size-3.5 shrink-0 text-muted-foreground/60" />
      <span class="min-w-0 flex-1 truncate font-mono text-xs" :class="settled ? 'text-muted-foreground' : 'text-fail'">{{ cluster.title }}</span>
      <ClusterStateBadge :cluster="cluster" />
      <Badge class="shrink-0 border-fail/30 bg-fail/15 text-[10px] text-fail">
        {{ cluster.tests }} {{ cluster.tests === 1 ? 'test' : 'tests' }}
      </Badge>
      <span class="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">{{ cluster.count }}×</span>
    </button>

    <div v-if="expanded" class="flex flex-col gap-3 border-t border-border/60 px-3 py-3">
      <ClusterTriageActions :cluster="cluster" :saving="saving" :disabled="disabled" @save="(change, message) => emit('save', change, message)" />

      <div class="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-muted-foreground">
        <span>First seen {{ formatDateTime(cluster.firstSeen) }}</span>
        <span>
          Last failed
          <RouterLink :to="{ name: 'run', params: { projectId, runId: cluster.lastRunId } }" class="underline-offset-2 hover:text-foreground hover:underline">{{ ago(cluster.lastSeen) }}</RouterLink>
        </span>
        <span v-if="cluster.quietRuns">Passed in {{ cluster.quietRuns }} {{ cluster.quietRuns === 1 ? 'run' : 'runs' }} since</span>
        <span v-if="cluster.triage?.resolvedAt">
          Resolved {{ ago(cluster.triage.resolvedAt) }}<template v-if="cluster.triage.resolvedBy"> by {{ cluster.triage.resolvedBy }}</template>
        </span>
        <span v-if="cluster.codeOwners?.length">Owners {{ cluster.codeOwners.join(' ') }}</span>
      </div>

      <div v-if="cluster.triage?.issueUrl || cluster.triage?.note" class="flex flex-col gap-1 rounded-md border border-border/60 bg-muted/30 px-3 py-2 text-xs">
        <a
          v-if="cluster.triage?.issueUrl"
          :href="cluster.triage.issueUrl"
          target="_blank"
          rel="noopener noreferrer"
          class="flex w-fit max-w-full items-center gap-1.5 font-mono text-signal hover:underline"
        >
          <ExternalLink class="size-3 shrink-0" />
          <span class="truncate">{{ cluster.triage.issueUrl }}</span>
        </a>
        <p v-if="cluster.triage?.note" class="whitespace-pre-wrap text-muted-foreground">
          {{ cluster.triage.note }}
        </p>
      </div>

      <div class="relative">
        <pre class="max-h-56 overflow-auto rounded-md bg-fail/5 p-3 pr-10 font-mono text-[11px] leading-relaxed text-fail">{{ cluster.sample }}</pre>
        <CopyButton :text="cluster.sample" class="absolute right-1 top-1" />
      </div>
      <div class="flex flex-col gap-1">
        <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Affected {{ cluster.tests === 1 ? 'test' : 'tests' }}
        </span>
        <RouterLink
          v-for="key in cluster.testKeys"
          :key="key"
          :to="{ name: 'test', params: { projectId }, query: { key } }"
          class="truncate font-mono text-xs text-muted-foreground hover:text-foreground"
        >
          {{ labels.get(key) ?? key }}
        </RouterLink>
      </div>
    </div>
  </div>
</template>
