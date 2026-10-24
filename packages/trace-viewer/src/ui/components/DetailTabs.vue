<script setup lang="ts">
import type { DetailTab } from '../store'
import { cn } from '@kinora/ui'
import { computed } from 'vue'
import { uniqueErrors } from '../lib/errors'
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

const errorCount = computed(() => uniqueErrors(store.model.value).length)
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
  // Only test-runner traces carry annotations (upstream hides the tab otherwise).
  ...(store.model.value?.annotations !== undefined ? [{ id: 'annotations' as const, label: 'Annotations', count: annotationCount.value }] : []),
])
// A remembered tab this trace doesn't have falls back to Source.
const activeTab = computed<DetailTab>(() => tabs.value.some(t => t.id === store.detailTab.value) ? store.detailTab.value : 'source')
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
          activeTab === t.id ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
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
          v-if="activeTab === t.id"
          class="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-signal"
        />
      </button>
    </div>
    <div class="min-h-0 flex-1">
      <SourceView v-if="activeTab === 'source'" />
      <CallView v-else-if="activeTab === 'call'" />
      <LocatorView v-else-if="activeTab === 'locator'" />
      <LogView v-else-if="activeTab === 'log'" />
      <NetworkView v-else-if="activeTab === 'network'" />
      <AttachmentsView v-else-if="activeTab === 'attachments'" />
      <ErrorsView v-else-if="activeTab === 'errors'" />
      <ConsoleView v-else-if="activeTab === 'console'" />
      <MetadataView v-else-if="activeTab === 'metadata'" />
      <AnnotationsView v-else />
    </div>
  </div>
</template>
