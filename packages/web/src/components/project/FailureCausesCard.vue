<script setup lang="ts">
import type { FailureCluster, TestHistory } from '@kinora/core'
import { isOpenCluster, isSnoozed } from '@kinora/core'
import { Button } from '@kinora/ui/button'
import { useRouteQuery } from '@vueuse/router'
import { computed, nextTick, ref, watch } from 'vue'
import FailureClusterRow from '@/components/project/FailureClusterRow.vue'
import { useDemo } from '@/composables/queries'
import { useClusterTriage } from '@/composables/useClusterTriage'
import { testLabel } from '@/lib/test-display'

const props = defineProps<{ clusters: FailureCluster[], histories: TestHistory[], projectId: string }>()

const TOP = 5

const isDemo = useDemo()
const { withTriage, isSaving, save } = useClusterTriage()
const all = computed(() => props.clusters.map(c => withTriage(props.projectId, c)))

// What still needs a look comes first; resolved, ignored and snoozed clusters wait behind a toggle.
const active = computed(() => all.value.filter(c => isOpenCluster(c) && !isSnoozed(c)))
const settled = computed(() => all.value.filter(c => !isOpenCluster(c) || isSnoozed(c)))

const showAll = ref(false)
const showSettled = ref(false)
const visible = computed(() => [
  ...(showAll.value ? active.value : active.value.slice(0, TOP)),
  ...(showSettled.value ? settled.value : []),
])

const labels = computed(() => new Map(props.histories.map(h => [h.testKey, testLabel(h)])))

// `?cluster=<fingerprint>` opens one cluster, as the overview's failure inbox links it.
const focus = useRouteQuery<string>('cluster', '')
const expanded = ref(new Set<string>(focus.value ? [focus.value] : []))
function toggle(fp: string): void {
  const next = new Set(expanded.value)
  next.has(fp) ? next.delete(fp) : next.add(fp)
  expanded.value = next
}

// Once, when the clusters arrive: the card mounts before the project history loads.
let focused = false
watch(() => props.clusters.length, async (n) => {
  if (focused || !focus.value || !n)
    return
  focused = true
  showAll.value = active.value.findIndex(c => c.fingerprint === focus.value) >= TOP
  showSettled.value = settled.value.some(c => c.fingerprint === focus.value)
  await nextTick()
  document.getElementById(`cluster-${focus.value}`)?.scrollIntoView({ block: 'start' })
}, { immediate: true })
</script>

<template>
  <div v-if="clusters.length" class="flex flex-col gap-3 rounded-xl border border-border/70 bg-card/80 px-6 py-5">
    <div class="flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
      <span>Top failure causes</span>
      <span>{{ clusters.length }} distinct {{ clusters.length === 1 ? 'error' : 'errors' }}</span>
    </div>

    <p v-if="!active.length" class="font-mono text-xs text-muted-foreground">
      Every failure cause here is resolved, ignored or snoozed.
    </p>

    <div v-if="visible.length" class="flex flex-col gap-2">
      <FailureClusterRow
        v-for="c in visible"
        :key="c.fingerprint"
        :cluster="c"
        :project-id="projectId"
        :labels="labels"
        :expanded="expanded.has(c.fingerprint)"
        :saving="isSaving(projectId, c.fingerprint)"
        :disabled="isDemo"
        @toggle="toggle(c.fingerprint)"
        @save="(change, message) => save(projectId, c.fingerprint, change, message)"
      />
    </div>

    <div v-if="active.length > TOP || settled.length" class="mt-1 flex flex-wrap justify-center gap-2">
      <Button
        v-if="active.length > TOP"
        variant="outline"
        size="sm"
        class="font-mono text-xs text-muted-foreground"
        @click="showAll = !showAll"
      >
        {{ showAll ? 'Show less' : `Show all ${active.length}` }}
      </Button>
      <Button
        v-if="settled.length"
        variant="outline"
        size="sm"
        class="font-mono text-xs text-muted-foreground"
        @click="showSettled = !showSettled"
      >
        {{ showSettled ? 'Hide' : 'Show' }} {{ settled.length }} resolved, ignored or snoozed
      </Button>
    </div>
  </div>
</template>
