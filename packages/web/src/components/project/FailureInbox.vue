<script setup lang="ts">
import type { InboxQueue } from '@kinora/core'
import type { TriageChange } from '@/composables/useClusterTriage'
import { INBOX_QUEUES, inInboxQueue } from '@kinora/core'
import { Badge } from '@kinora/ui/badge'
import { Button } from '@kinora/ui/button'
import { SegmentedControl } from '@kinora/ui/segmented-control'
import { Skeleton } from '@kinora/ui/skeleton'
import { useRouteQuery } from '@vueuse/router'
import { computed, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import ClusterStateBadge from '@/components/project/ClusterStateBadge.vue'
import ClusterTriageActions from '@/components/project/ClusterTriageActions.vue'
import { useDemo, useFailureInbox } from '@/composables/queries'
import { useClusterTriage } from '@/composables/useClusterTriage'
import { useNewFeature } from '@/composables/useNewFeature'
import { ago, QUEUE_LABEL } from '@/lib/cluster-triage'
import { session } from '@/lib/session'

const TOP = 8

const { state, isLoading, error } = useFailureInbox()
const isDemo = useDemo()
const { withTriage, isSaving, save } = useClusterTriage()
const me = computed(() => session.user.value?.id)
// The inbox has no page of its own to open: the badge goes once the user acts in it.
const { isNew, markSeen } = useNewFeature('failureInbox')

const items = computed(() => (state.value ?? []).map(c => withTriage(c.project.id, c)))

const queue = useRouteQuery<string>('queue', 'all')
const current = computed<InboxQueue>(() => (INBOX_QUEUES as readonly string[]).includes(queue.value) ? queue.value as InboxQueue : 'all')
const counts = computed(() => Object.fromEntries(INBOX_QUEUES.map(q => [q, items.value.filter(c => inInboxQueue(c, q, me.value)).length])) as Record<InboxQueue, number>)
// The first two queues always show, so switching never leaves the control empty.
const options = computed(() => INBOX_QUEUES
  .filter(q => q === 'all' || q === 'untriaged' || counts.value[q] > 0 || q === current.value)
  .map(q => ({ value: q, label: `${QUEUE_LABEL[q]} ${counts.value[q]}` })))

watch(queue, markSeen)

function triage(projectId: string, fingerprint: string, change: TriageChange, message: string): void {
  markSeen()
  void save(projectId, fingerprint, change, message)
}

const showAll = ref(false)
const rows = computed(() => items.value.filter(c => inInboxQueue(c, current.value, me.value)))
const visible = computed(() => (showAll.value ? rows.value : rows.value.slice(0, TOP)))
</script>

<template>
  <Skeleton v-if="isLoading && !state" class="h-40 rounded-xl" />
  <section
    v-else-if="!error && items.length"
    aria-labelledby="failure-inbox-title"
    class="flex flex-col gap-4 rounded-xl border border-border/70 bg-card/80 px-6 py-5"
  >
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h2 id="failure-inbox-title" class="flex items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          Failure inbox
          <Badge v-if="isNew" class="border-signal/30 bg-signal px-1.5 py-0.5 text-[9px] leading-none tracking-wider text-white">
            New
          </Badge>
        </h2>
        <p class="mt-1 text-sm text-muted-foreground">
          Open failure causes across your projects, each grouped by error.
        </p>
      </div>
      <SegmentedControl v-model="queue" :options="options" />
    </div>

    <p v-if="!rows.length" class="py-4 text-center font-mono text-xs text-muted-foreground">
      Nothing in this queue.
    </p>

    <ul v-else class="flex flex-col divide-y divide-border/60">
      <li
        v-for="c in visible"
        :key="`${c.project.id}:${c.fingerprint}`"
        data-testid="inbox-cluster"
        class="flex flex-col gap-2 py-3 first:pt-0 last:pb-0 lg:flex-row lg:items-center lg:gap-4"
      >
        <div class="flex min-w-0 flex-1 flex-col gap-1">
          <RouterLink
            :to="{ name: 'tests', params: { projectId: c.project.id }, query: { cluster: c.fingerprint } }"
            class="truncate font-mono text-xs text-fail hover:underline"
            @click="markSeen"
          >
            {{ c.title }}
          </RouterLink>
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] text-muted-foreground">
            <span class="text-foreground/80">{{ c.project.name }}</span>
            <span>{{ c.tests }} {{ c.tests === 1 ? 'test' : 'tests' }}, {{ c.count }}×</span>
            <span>last failed {{ ago(c.lastSeen) }}</span>
            <ClusterStateBadge :cluster="c" />
            <Badge v-if="c.triage?.issueUrl" class="border-signal/30 bg-signal/10 text-[10px] text-signal">
              Issue linked
            </Badge>
          </div>
        </div>
        <ClusterTriageActions
          compact
          :cluster="c"
          :saving="isSaving(c.project.id, c.fingerprint)"
          :disabled="isDemo"
          @save="(change, message) => triage(c.project.id, c.fingerprint, change, message)"
        />
      </li>
    </ul>

    <Button
      v-if="rows.length > TOP"
      variant="outline"
      size="sm"
      class="self-center font-mono text-xs text-muted-foreground"
      @click="showAll = !showAll"
    >
      {{ showAll ? 'Show less' : `Show all ${rows.length}` }}
    </Button>
  </section>
</template>
