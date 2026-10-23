<script setup lang="ts">
import type { ColorMode } from '@kinora/ui/theme'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuRadioGroup, DropdownMenuRadioItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@kinora/ui/dropdown-menu'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@kinora/ui/resizable'
import { colorMode } from '@kinora/ui/theme'
import { TooltipProvider } from '@kinora/ui/tooltip'
import { Download, Loader2, Monitor, Moon, PanelBottom, PanelRight, Settings, Sun } from '@lucide/vue'
import { useStorage } from '@vueuse/core'
import { computed, onMounted } from 'vue'
import ActionsList from './components/ActionsList.vue'
import DetailTabs from './components/DetailTabs.vue'
import SnapshotPlayer from './components/SnapshotPlayer.vue'
import Timeline from './components/Timeline.vue'
import TraceDropZone from './components/TraceDropZone.vue'
import { useKeyboardNav } from './lib/useKeyboardNav'
import { useTraceDrop } from './lib/useTraceDrop'
import { useTraceStore } from './store'

const store = useTraceStore()
const unsupportedTraceVersion = computed(() => store.errorKind.value === 'unsupported-trace-version')
// Same storage as the dashboard's theme toggle, so both stay in sync.
const THEMES = [
  { value: 'auto', label: 'System', icon: Monitor },
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
] as const

const loadPercent = computed(() => {
  const progress = store.loadProgress.value
  return progress?.total ? Math.round((progress.done / progress.total) * 100) : undefined
})

// Persisted panel sizes (percentages).
const cols = useStorage('kinora-tv-cols', [22, 78])
const rows = useStorage('kinora-tv-rows', [62, 38])
// Docked right, the detail tabs get the full height, which short windows need most.
const dock = useStorage<'bottom' | 'right'>('kinora-tv-details-dock', 'bottom')
const dockCols = useStorage('kinora-tv-dock-cols', [58, 42])

useKeyboardNav()

async function downloadTrace(): Promise<void> {
  const uri = store.traceUri.value
  if (!uri)
    return
  const name = store.traceName.value || decodeURIComponent(new URL(uri, location.href).pathname.split('/').pop() || '') || 'trace.zip'
  try {
    const res = await fetch(uri)
    if (!res.ok)
      throw new Error(String(res.status))
    const href = URL.createObjectURL(await res.blob())
    const a = document.createElement('a')
    a.href = href
    a.download = name.endsWith('.zip') ? name : `${name}.zip`
    a.click()
    setTimeout(() => URL.revokeObjectURL(href), 0)
  }
  catch {
    // Only ever navigate to http(s): a trace URI is attacker-controlled via ?trace=.
    const resolved = new URL(uri, location.href)
    if (resolved.protocol === 'http:' || resolved.protocol === 'https:')
      window.open(resolved.href, '_blank', 'noopener,noreferrer')
  }
}
const { isDragging } = useTraceDrop()

onMounted(() => {
  // No ?trace= means someone landed on the viewer directly (the public
  // kinora.dev entry point), so offer the drop zone rather than guess a trace.
  const param = new URLSearchParams(location.search).get('trace')
  const pending = store.consumePendingLoad()
  if (param)
    void store.load(param)
  else if (pending)
    void store.load(pending.uri, pending.name)
})
</script>

<template>
  <TooltipProvider :delay-duration="300">
    <div class="relative grid h-full grid-rows-[auto_minmax(0,1fr)] bg-background text-foreground">
      <div
        v-if="isDragging"
        class="pointer-events-none absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm"
      >
        <div class="rounded-xl border-2 border-dashed border-signal px-10 py-8 text-sm font-medium">
          Drop trace.zip to open it
        </div>
      </div>
      <!-- global top bar -->
      <header class="flex h-11 items-center gap-2.5 border-b border-border px-4">
        <span class="size-2 rounded-full bg-signal" style="animation: rec-pulse 2s ease-in-out infinite" />
        <div class="flex min-w-0 items-baseline gap-2.5">
          <span class="text-sm font-semibold tracking-tight">kinora</span>
          <span class="font-mono text-[11px] text-muted-foreground">trace</span>
          <span v-if="store.traceName.value || store.model.value?.title" class="min-w-0 truncate text-xs text-muted-foreground">
            · {{ store.traceName.value || store.model.value?.title }}
          </span>
        </div>
        <div class="ml-auto flex items-center gap-1">
          <button
            v-if="store.status.value === 'ready' && store.traceUri.value"
            type="button"
            data-testid="download-trace"
            class="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Download trace"
            aria-label="Download trace"
            @click="downloadTrace"
          >
            <Download class="size-4" />
          </button>
          <button
            v-if="store.status.value === 'ready'"
            type="button"
            data-testid="details-dock"
            class="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            :title="dock === 'bottom' ? 'Dock details to the right' : 'Dock details to the bottom'"
            :aria-label="dock === 'bottom' ? 'Dock details to the right' : 'Dock details to the bottom'"
            @click="dock = dock === 'bottom' ? 'right' : 'bottom'"
          >
            <component :is="dock === 'bottom' ? PanelRight : PanelBottom" class="size-4" />
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger
              class="flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground data-[state=open]:bg-muted data-[state=open]:text-foreground"
              title="Settings"
              aria-label="Settings"
            >
              <Settings class="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" class="w-60">
              <DropdownMenuLabel>Theme</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuRadioGroup :model-value="colorMode" @update:model-value="(value) => (colorMode = value as ColorMode)">
                <DropdownMenuRadioItem v-for="theme in THEMES" :key="theme.value" :value="theme.value" class="gap-2">
                  <component :is="theme.icon" class="size-3.5 text-muted-foreground" />
                  {{ theme.label }}
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>Snapshots</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem v-model="store.canvasFromScreenshot.value">
                Display canvas content
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </header>

      <!-- empty / loading / error -->
      <TraceDropZone v-if="store.status.value === 'idle'" />
      <div v-else-if="store.status.value === 'loading'" class="flex flex-col items-center justify-center gap-3 text-sm text-muted-foreground">
        <div class="flex items-center gap-2">
          <Loader2 class="size-4 animate-spin" />
          Loading trace…
        </div>
        <div
          v-if="loadPercent !== undefined"
          data-testid="load-progress"
          role="progressbar"
          :aria-valuenow="loadPercent"
          aria-valuemin="0"
          aria-valuemax="100"
          class="h-1 w-56 overflow-hidden rounded-full bg-muted"
        >
          <div class="h-full rounded-full bg-signal transition-[width]" :style="{ width: `${loadPercent}%` }" />
        </div>
      </div>
      <div v-else-if="store.status.value === 'error'" class="flex flex-col items-center justify-center p-8">
        <div class="max-w-md rounded-lg border border-fail/30 bg-fail/5 p-4 text-sm text-fail">
          <div class="mb-1 font-semibold">
            Failed to load trace
          </div>
          <div class="font-mono text-xs text-fail/80">
            {{ store.errorMessage.value }}
          </div>
          <div v-if="unsupportedTraceVersion" class="mt-4 border-t border-fail/20 pt-3 text-xs text-fail/80">
            This trace was generated by a newer Playwright version. Update Kinora to get the latest trace viewer, email
            <a class="underline underline-offset-2 hover:text-fail" href="mailto:hi@kinora.dev">hi@kinora.dev</a>,
            or
            <a
              class="underline underline-offset-2 hover:text-fail"
              href="https://github.com/kinora-dev/kinora/issues/new"
              target="_blank"
              rel="noreferrer"
            >open an issue</a>.
          </div>
        </div>
        <TraceDropZone compact />
      </div>

      <!-- workbench -->
      <ResizablePanelGroup
        v-else
        direction="horizontal"
        @layout="(s: number[]) => (cols = s)"
      >
        <ResizablePanel :default-size="cols[0]" :min-size="14" :max-size="40">
          <ActionsList />
        </ResizablePanel>
        <ResizableHandle with-handle />
        <ResizablePanel :default-size="cols[1]">
          <ResizablePanelGroup
            v-if="dock === 'right'"
            key="right"
            direction="horizontal"
            @layout="(s: number[]) => (dockCols = s)"
          >
            <ResizablePanel :default-size="dockCols[0]" :min-size="25">
              <div class="grid h-full grid-rows-[auto_minmax(0,1fr)]">
                <Timeline />
                <SnapshotPlayer />
              </div>
            </ResizablePanel>
            <ResizableHandle with-handle />
            <ResizablePanel :default-size="dockCols[1]" :min-size="20">
              <div data-testid="details-panel" class="h-full border-l border-border">
                <DetailTabs />
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
          <div v-else class="grid h-full grid-rows-[auto_minmax(0,1fr)]">
            <Timeline />
            <ResizablePanelGroup
              key="bottom"
              direction="vertical"
              @layout="(s: number[]) => (rows = s)"
            >
              <ResizablePanel :default-size="rows[0]" :min-size="20">
                <SnapshotPlayer />
              </ResizablePanel>
              <ResizableHandle with-handle />
              <ResizablePanel :default-size="rows[1]" :min-size="15">
                <div data-testid="details-panel" class="h-full">
                  <DetailTabs />
                </div>
              </ResizablePanel>
            </ResizablePanelGroup>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  </TooltipProvider>
</template>
