<script setup lang="ts">
import type { DetailTab } from '../store'
import { cn } from '@kinora/ui'
import { computed } from 'vue'
import { useTraceStore } from '../store'
import AnnotationsView from './AnnotationsView.vue'
import AttachmentsView from './AttachmentsView.vue'
import CallView from './CallView.vue'
import ConsoleView from './ConsoleView.vue'
import ErrorsView from './ErrorsView.vue'
import LocatorView from './LocatorView.vue'
import LogView from './LogView.vue'
import MetadataView from './MetadataView.vue'
import NetworkView from './NetworkView.vue'
import SourceView from './SourceView.vue'

const store = useTraceStore()

const errorCount = computed(() => store.model.value?.errorDescriptors.length ?? 0)
// Badges count what the tab lists (scope, brushed window, folded repeats), not a separate tally.
const consoleCount = computed(() => store.scopedConsoleEntries.value.length)
const networkCount = computed(() => store.scopedNetworkRows.value.length)
const attachmentCount = computed(() => store.model.value?.visibleAttachments.length ?? 0)
const annotationCount = computed(() => store.model.value?.annotations?.length ?? 0)

const tabs = computed<{ id: DetailTab, label: string, count?: number }[]>(() => [
  { id: 'source', label: 'Source' },
  { id: 'call', label: 'Call' },
  { id: 'locator', label: 'Locator' },
  { id: 'log', label: 'Log' },
  { id: 'network', label: 'Network', count: networkCount.value },
  { id: 'attachments', label: 'Attachments', count: attachmentCount.value },
  { id: 'errors', label: 'Errors', count: errorCount.value },
  { id: 'console', label: 'Console', count: consoleCount.value },
  { id: 'metadata', label: 'Metadata' },
  { id: 'annotations', label: 'Annotations', count: annotationCount.value },
])
</script>

<template>
  <div class="flex h-full flex-col">
    <div :class="cn('flex shrink-0 items-center gap-1 overflow-x-auto border-b border-border px-2', store.detailsDock.value === 'right' ? 'h-11' : 'h-9')">
      <button
        v-for="t in tabs"
        :key="t.id"
        type="button"
        :class="cn(
          'relative flex shrink-0 items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors',
          store.detailTab.value === t.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
        )"
        @click="store.setDetailTab(t.id)"
      >
        {{ t.label }}
        <span
          v-if="t.count"
          :class="cn(
            'rounded-full px-1.5 text-[10px] tabular-nums',
            t.id === 'errors' ? 'bg-fail/20 text-fail' : 'bg-muted text-muted-foreground',
          )"
        >{{ t.count }}</span>
        <span
          v-if="store.detailTab.value === t.id"
          class="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-signal"
        />
      </button>
    </div>
    <div class="min-h-0 flex-1">
      <SourceView v-if="store.detailTab.value === 'source'" />
      <CallView v-else-if="store.detailTab.value === 'call'" />
      <LocatorView v-else-if="store.detailTab.value === 'locator'" />
      <LogView v-else-if="store.detailTab.value === 'log'" />
      <NetworkView v-else-if="store.detailTab.value === 'network'" />
      <AttachmentsView v-else-if="store.detailTab.value === 'attachments'" />
      <ErrorsView v-else-if="store.detailTab.value === 'errors'" />
      <ConsoleView v-else-if="store.detailTab.value === 'console'" />
      <MetadataView v-else-if="store.detailTab.value === 'metadata'" />
      <AnnotationsView v-else />
    </div>
  </div>
</template>
