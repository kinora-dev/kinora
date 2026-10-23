<script setup lang="ts">
import { Check, Copy } from '@lucide/vue'
import { useStorage } from '@vueuse/core'
import { computed, ref, watch } from 'vue'
import { actionTitle } from '../lib/action'
import { collectAriaTargets } from '../lib/snapshots'
import { useLocatorPicker } from '../lib/useLocatorPicker'
import { useTraceStore } from '../store'
import AriaSnapshotView from './AriaSnapshotView.vue'
import DomSnapshotView from './DomSnapshotView.vue'
import SnapshotToolbar from './SnapshotToolbar.vue'
import TextTooltip from './TextTooltip.vue'

type SnapshotMode = 'dom' | 'aria'

const store = useTraceStore()
const ariaSetting = useStorage('kinora-tv-aria-mode', false)
const actualSize = useStorage('kinora-tv-snapshot-actual-size', false)
// A trace with ARIA data but no DOM snapshots can only be shown in ARIA mode.
const canToggleAria = computed(() => !!store.model.value?.hasDomSnapshots && !!store.model.value?.hasAriaSnapshots)
const mode = computed<SnapshotMode>(() => {
  const aria = canToggleAria.value ? ariaSetting.value : !!store.model.value?.hasAriaSnapshots
  return aria ? 'aria' : 'dom'
})
const viewport = computed(() => store.snapshotInfo.value.viewport)
const pageUrl = computed(() => store.snapshotInfo.value.url ?? '')
const frameSrc = computed(() => store.currentSnapshotUrl.value ?? 'about:blank')
const hasSnapshot = computed(() => !!store.currentSnapshotUrl.value)
const ariaTarget = computed(() => collectAriaTargets(store.model.value, store.activeAction.value)[store.snapshotTab.value])
const ariaEvent = computed(() => {
  const target = ariaTarget.value
  return target && store.model.value?.ariaSnapshotForCall(target.action.callId, target.phase)
})
const ariaUrl = computed(() => fileUrl(ariaEvent.value?.file))
const screenshotUrl = computed(() => {
  const target = ariaTarget.value
  return fileUrl(target && store.model.value?.screenshotForCall(target.action.callId, target.phase)?.file)
})
const actionPhase = computed(() => store.snapshotTab.value === 'action' ? store.activeAction.value : undefined)

function fileUrl(file: string | undefined): string | undefined {
  const model = store.model.value
  return file && model ? model.createRelativeUrl(`file/${file}`) : undefined
}

function setMode(value: SnapshotMode): void {
  ariaSetting.value = value === 'aria'
}

const ariaTerms = computed(() => {
  const action = store.activeAction.value
  if (!action)
    return []
  const params = action.params ?? {}
  const quoted = [...actionTitle(action).matchAll(/[“"]([^”"]+)[”"]/g)].map(match => match[1])
  return [params.value, params.expected, params.selector?.replace(/^#/, ''), ...quoted]
    .filter((term): term is string => typeof term === 'string' && term.length >= 2)
})

const { setIframe } = useLocatorPicker()

const urlCopied = ref(false)

async function copyUrl(): Promise<void> {
  if (!pageUrl.value)
    return
  await navigator.clipboard.writeText(pageUrl.value)
  urlCopied.value = true
  setTimeout(() => (urlCopied.value = false), 1500)
}

function openSnapshot(): void {
  if (store.currentSnapshotUrl.value)
    window.open(store.currentSnapshotUrl.value, '_blank', 'noopener,noreferrer')
}

function toggleInspector(): void {
  store.setInspectingLocator(!store.inspectingLocator.value)
}

// The picker needs the DOM snapshot.
watch(mode, (value) => {
  if (value === 'aria' && store.inspectingLocator.value)
    store.setInspectingLocator(false)
})

watch(frameSrc, () => {
  void store.refreshSnapshotInfo()
}, { immediate: true })
</script>

<template>
  <div class="flex h-full flex-col bg-background">
    <SnapshotToolbar
      :actual-size="actualSize"
      :mode="mode"
      :selected-tab="store.snapshotTab.value"
      :has-snapshot="hasSnapshot && mode === 'dom'"
      :can-toggle-aria="canToggleAria"
      :inspecting="store.inspectingLocator.value"
      :viewport="viewport"
      @set-tab="store.setTab"
      @set-mode="setMode"
      @toggle-inspector="toggleInspector"
      @open-snapshot="openSnapshot"
      @toggle-actual-size="actualSize = !actualSize"
    />

    <div class="flex min-h-0 flex-1 flex-col p-3">
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-card shadow-2xl shadow-black/40">
        <div class="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-muted/40 px-3">
          <div class="flex gap-1.5">
            <span class="size-2.5 rounded-full bg-fail/70" />
            <span class="size-2.5 rounded-full bg-flaky/70" />
            <span class="size-2.5 rounded-full bg-pass/70" />
          </div>
          <div class="ml-1 flex h-5 min-w-0 flex-1 items-center rounded-md border border-border/70 bg-background/60 px-2.5">
            <TextTooltip :text="pageUrl || 'about:blank'" class="min-w-0 flex-1 font-mono text-[11px] text-muted-foreground" />
            <button
              v-if="pageUrl"
              type="button"
              title="Copy URL"
              class="-mr-1.5 ml-1 flex size-4 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:text-foreground"
              @click="copyUrl"
            >
              <component :is="urlCopied ? Check : Copy" class="size-3" />
            </button>
          </div>
        </div>
        <div class="relative min-h-0 flex-1 bg-muted/30">
          <img
            v-if="store.playbackFrameUrl.value"
            data-testid="playback-frame"
            :src="store.playbackFrameUrl.value"
            alt=""
            class="size-full object-contain object-top"
          >
          <DomSnapshotView
            v-else-if="mode === 'dom'"
            :actual-size="actualSize"
            :src="frameSrc"
            :viewport="viewport"
            @loaded="setIframe"
          />
          <AriaSnapshotView
            v-else
            :url="ariaUrl"
            :screenshot-url="screenshotUrl"
            :point="actionPhase?.point"
            :box="actionPhase?.box"
            :call-id="ariaTarget?.action.callId"
            :phase="ariaTarget?.phase"
            :file="ariaEvent?.file"
            :terms="ariaTerms"
          />
        </div>
      </div>
    </div>
  </div>
</template>
