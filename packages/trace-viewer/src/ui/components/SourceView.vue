<script setup lang="ts">
import type { StackFrame } from '@trace/trace'
import { cn } from '@kinora/ui'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { calculateSha1 } from '../lib/sha1'
import { useTraceStore } from '../store'

// Lazy-load CodeMirror: it only matters once an action with a stack is selected.
const CodeView = defineAsyncComponent(() => import('./CodeView.vue'))

const store = useTraceStore()

const frames = computed<StackFrame[]>(() => store.selectedAction.value?.stack ?? [])
const selectedFrame = ref(0)
const content = ref('')
const loading = ref(false)

const targetLine = computed(() => frames.value[selectedFrame.value]?.line ?? 0)
const lang = computed(() => fileName(frames.value[selectedFrame.value]?.file ?? '').split('.').pop()?.toLowerCase() ?? '')

function fileName(file: string): string {
  return file.split(/[/\\]/).pop() ?? file
}

watch([frames, selectedFrame], async () => {
  selectedFrame.value = Math.min(selectedFrame.value, Math.max(0, frames.value.length - 1))
  const frame = frames.value[selectedFrame.value]
  const model = store.model.value
  if (!frame?.file || !model) {
    content.value = ''
    return
  }
  loading.value = true
  try {
    const sha1 = await calculateSha1(frame.file)
    const res = await fetch(model.createRelativeUrl(`file/resources/src@${sha1}.txt`))
    content.value = res.ok ? await res.text() : `Source unavailable for ${frame.file}`
  }
  catch {
    content.value = `Unable to read ${frame.file}`
  }
  finally {
    loading.value = false
  }
}, { immediate: true })

watch(() => store.selectedId.value, () => {
  selectedFrame.value = 0
})
</script>

<template>
  <div class="flex h-full">
    <!-- stack frames -->
    <div v-if="frames.length" class="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border">
      <button
        v-for="(frame, i) in frames"
        :key="i"
        type="button"
        :class="cn(
          'flex flex-col gap-0.5 border-b border-border/50 px-3 py-1.5 text-left transition-colors',
          selectedFrame === i ? 'bg-signal/10' : 'hover:bg-muted/50',
        )"
        @click="selectedFrame = i"
      >
        <span class="truncate text-xs text-foreground/90">{{ frame.function || '(anonymous)' }}</span>
        <span class="truncate font-mono text-[10px] text-muted-foreground">{{ fileName(frame.file) }}:{{ frame.line }}</span>
      </button>
    </div>

    <!-- code -->
    <div class="min-w-0 flex-1 overflow-hidden">
      <div v-if="loading" class="p-3 text-sm text-muted-foreground">
        Loading source…
      </div>
      <div v-else-if="!frames.length" class="flex h-full items-center justify-center text-sm text-muted-foreground">
        No source for this action
      </div>
      <CodeView v-else :code="content" :lang="lang" :highlight-line="targetLine" />
    </div>
  </div>
</template>
