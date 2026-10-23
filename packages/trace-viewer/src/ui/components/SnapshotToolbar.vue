<script setup lang="ts">
import type { SnapshotTab } from '../lib/snapshots'
import { cn } from '@kinora/ui'
import { ExternalLink, Monitor, Target } from '@lucide/vue'

type SnapshotMode = 'dom' | 'aria'

defineProps<{
  actualSize: boolean
  mode: SnapshotMode
  selectedTab: SnapshotTab
  canToggleAria: boolean
  hasSnapshot: boolean
  inspecting: boolean
  viewport?: { width: number, height: number }
}>()

const emit = defineEmits<{
  openSnapshot: []
  toggleActualSize: []
  setMode: [mode: SnapshotMode]
  setTab: [tab: SnapshotTab]
  toggleInspector: []
}>()

const tabs: { id: SnapshotTab, label: string }[] = [
  { id: 'before', label: 'Before' },
  { id: 'action', label: 'Action' },
  { id: 'after', label: 'After' },
]
</script>

<template>
  <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-2">
    <div class="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
      <button
        v-for="tab in tabs"
        :key="tab.id"
        type="button"
        :class="cn(
          'rounded px-2.5 py-1 text-xs font-medium transition-colors',
          selectedTab === tab.id
            ? 'bg-card text-foreground shadow-sm'
            : 'text-muted-foreground hover:text-foreground',
        )"
        @click="emit('setTab', tab.id)"
      >
        {{ tab.label }}
      </button>
    </div>
    <div class="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
      <div v-if="canToggleAria" class="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
        <button
          type="button"
          :class="cn(
            'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
            mode === 'dom' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )"
          @click="emit('setMode', 'dom')"
        >
          DOM
        </button>
        <button
          type="button"
          :class="cn(
            'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
            mode === 'aria' ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )"
          @click="emit('setMode', 'aria')"
        >
          ARIA
        </button>
      </div>
      <Monitor class="size-3.5" />
      <span v-if="viewport" class="font-mono tabular-nums">{{ viewport.width }}×{{ viewport.height }}</span>
      <button
        v-if="viewport && mode === 'dom'"
        type="button"
        data-testid="snapshot-zoom"
        class="rounded px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        :title="actualSize ? 'Showing at 100%. Click to fit the panel' : 'Fitted to the panel. Click to show at 100%'"
        @click="emit('toggleActualSize')"
      >
        {{ actualSize ? '100%' : 'Fit' }}
      </button>
      <button
        type="button"
        :class="cn(
          'flex size-7 items-center justify-center rounded-md transition-colors disabled:opacity-30',
          inspecting ? 'bg-signal/15 text-signal' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
        )"
        title="Pick locator"
        :disabled="!hasSnapshot"
        @click="emit('toggleInspector')"
      >
        <Target class="size-3.5" />
      </button>
      <button
        type="button"
        class="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-30"
        title="Open snapshot in new tab"
        :disabled="!hasSnapshot"
        @click="emit('openSnapshot')"
      >
        <ExternalLink class="size-3.5" />
      </button>
    </div>
  </div>
</template>
