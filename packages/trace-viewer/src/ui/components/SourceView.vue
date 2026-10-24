<script setup lang="ts">
import type { StackFrame } from '@trace/trace'
import { cn } from '@kinora/ui'
import { Check, Copy, ExternalLink } from '@lucide/vue'
import { computed, defineAsyncComponent, ref, watch } from 'vue'
import { stripAnsi } from '../lib/ansi'
import { copyText } from '../lib/clipboard'
import { desktopBridge, vscodeUrl } from '../lib/editor'
import { calculateSha1 } from '../lib/sha1'
import { useTraceStore } from '../store'

// Lazy-load CodeMirror: it only matters once an action with a stack is selected.
const CodeView = defineAsyncComponent(() => import('./CodeView.vue'))

const store = useTraceStore()

const frames = computed<StackFrame[]>(() => store.sourceReveal.value?.stack ?? store.activeAction.value?.stack ?? [])
const revealVersion = computed(() => store.sourceReveal.value?.version ?? 0)
const selectedFrame = ref(0)
const content = ref('')
const loading = ref(false)

const frame = computed<StackFrame | undefined>(() => frames.value[selectedFrame.value])
const targetLine = computed(() => frame.value?.line ?? 0)
const lang = computed(() => fileName(frame.value?.file ?? '').split('.').pop()?.toLowerCase() ?? '')
// Upstream only annotates action errors (`model.sources`); test-runner errors carry a location too,
// and they are what CI traces mostly contain.
const errors = computed(() => (store.model.value?.errorDescriptors ?? [])
  .filter(error => !!frame.value && error.stack?.[0]?.file === frame.value.file)
  .map(error => ({ line: error.stack![0].line, message: stripAnsi(error.message) })))

const desktop = desktopBridge()
const copied = ref(false)
const openError = ref('')

async function copyFileName(): Promise<void> {
  if (!frame.value)
    return
  if (!await copyText(fileName(frame.value.file)))
    return
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}

async function openInEditor(): Promise<void> {
  const f = frame.value
  if (!f)
    return
  openError.value = ''
  if (!desktop?.openInEditor) {
    // Hands the link to the OS protocol handler; the viewer stays on the page.
    window.location.href = vscodeUrl(f.file, f.line, f.column)
    return
  }
  const { error } = await desktop.openInEditor(f.file, f.line, f.column)
  openError.value = error ?? ''
}

function fileName(file: string): string {
  return file.split(/[/\\]/).pop() ?? file
}

// Like Node's `path.extname`, which names the file in the trace: '' without a dot or for a dotfile.
function extname(file: string): string {
  const name = fileName(file)
  const dot = name.lastIndexOf('.')
  return dot <= 0 ? '' : name.slice(dot)
}

async function fetchSource(file: string, model: NonNullable<typeof store.model.value>): Promise<string> {
  try {
    const sha1 = await calculateSha1(file)
    // Current traces first, like upstream; older ones stored sources as `resources/src@<sha1>.txt`.
    const modern = await fetch(model.createRelativeUrl(`file/src/${sha1}${extname(file)}`))
    if (modern.ok)
      return await modern.text()
    const legacy = await fetch(model.createRelativeUrl(`file/resources/src@${sha1}.txt`))
    return legacy.ok ? await legacy.text() : `Source unavailable for ${file}`
  }
  catch {
    return `Unable to read ${file}`
  }
}

// Stepping through actions of one spec file reads it once per trace.
let sourceCache = new Map<string, Promise<string>>()
watch(() => store.model.value, () => (sourceCache = new Map()))

function readSource(file: string, model: NonNullable<typeof store.model.value>): Promise<string> {
  let text = sourceCache.get(file)
  if (!text) {
    text = fetchSource(file, model)
    sourceCache.set(file, text)
  }
  return text
}

watch([frames, selectedFrame], async (_, __, onCleanup) => {
  // A newer frame or action replaced this one before its source arrived.
  let stale = false
  onCleanup(() => (stale = true))
  selectedFrame.value = Math.min(selectedFrame.value, Math.max(0, frames.value.length - 1))
  const frame = frames.value[selectedFrame.value]
  const model = store.model.value
  if (!frame?.file || !model) {
    content.value = ''
    loading.value = false
    return
  }
  loading.value = true
  const text = await readSource(frame.file, model)
  if (stale)
    return
  content.value = text
  loading.value = false
}, { immediate: true })

watch([() => store.selectedId.value, revealVersion], () => {
  selectedFrame.value = 0
})

watch(frame, () => (openError.value = ''))
</script>

<template>
  <div class="flex h-full">
    <!-- stack frames -->
    <div v-if="frames.length > 1" data-testid="stack-frames" class="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-border">
      <button
        v-for="(stackFrame, i) in frames"
        :key="i"
        type="button"
        :class="cn(
          'flex flex-col gap-0.5 border-b border-border/50 px-3 py-1.5 text-left transition-colors',
          selectedFrame === i ? 'bg-signal/10' : 'hover:bg-muted/50',
        )"
        @click="selectedFrame = i"
      >
        <span class="truncate text-xs text-foreground/90">{{ stackFrame.function || '(anonymous)' }}</span>
        <span class="truncate font-mono text-[10px] text-muted-foreground">{{ fileName(stackFrame.file) }}:{{ stackFrame.line }}</span>
      </button>
    </div>

    <!-- code -->
    <div class="flex min-w-0 flex-1 flex-col overflow-hidden">
      <div v-if="frame?.file" class="flex h-8 shrink-0 items-center gap-1 border-b border-border px-3 text-xs">
        <span data-testid="source-file-name" class="min-w-0 truncate font-mono text-foreground/90" :title="frame.file">{{ fileName(frame.file) }}</span>
        <button
          type="button"
          class="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Copy filename"
          @click="copyFileName"
        >
          <component :is="copied ? Check : Copy" class="size-3" />
          {{ copied ? 'Copied' : 'Copy filename' }}
        </button>
        <span v-if="openError" data-testid="open-in-editor-error" class="ml-auto min-w-0 truncate text-[11px] text-fail" :title="openError">{{ openError }}</span>
        <button
          type="button"
          :class="cn('inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', !openError && 'ml-auto')"
          :title="desktop?.openInEditor ? 'Open in editor' : 'Open in VS Code'"
          @click="openInEditor"
        >
          <ExternalLink class="size-3" />
          {{ desktop?.openInEditor ? 'Open in editor' : 'Open in VS Code' }}
        </button>
      </div>
      <div class="min-h-0 flex-1 overflow-hidden">
        <div v-if="loading" class="p-3 text-sm text-muted-foreground">
          Loading source…
        </div>
        <div v-else-if="!frames.length" class="flex h-full items-center justify-center text-sm text-muted-foreground">
          No source for this action
        </div>
        <CodeView v-else :code="content" :errors="errors" :lang="lang" :highlight-line="targetLine" />
      </div>
    </div>
  </div>
</template>
