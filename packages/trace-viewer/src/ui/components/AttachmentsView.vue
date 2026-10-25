<script setup lang="ts">
import type { Attachment } from '@isomorphic/trace/traceModel'
import { isTextualMimeType } from '@isomorphic/mimeType'
import { cn } from '@kinora/ui'
import { ChevronRight, Download, ExternalLink, Paperclip } from '@lucide/vue'
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { groupImageDiffs } from '../lib/attachments'
import { bodyLang } from '../lib/network'
import { useTraceStore } from '../store'
import CodeView from './CodeView.vue'
import ImageDiff from './ImageDiff.vue'

const store = useTraceStore()

interface AttachmentView {
  callId: string
  key: string
  name: string
  contentType: string
  url?: string
  isImage: boolean
  isVideo: boolean
  isText: boolean
}

function attachmentUrl(att: Attachment): string | undefined {
  const model = store.model.value
  if (att.file && model)
    return model.createRelativeUrl(`file/${att.file}`)
  if (att.base64)
    return `data:${att.contentType};base64,${att.base64}`
  return undefined
}

const grouped = computed(() => groupImageDiffs(store.model.value?.visibleAttachments ?? []))

const diffs = computed(() =>
  grouped.value.diffs.map(g => ({
    callId: g.expected?.callId ?? '',
    name: g.name,
    expected: g.expected && attachmentUrl(g.expected),
    actual: g.actual && attachmentUrl(g.actual),
    diff: g.diff && attachmentUrl(g.diff),
  })),
)

const views = computed<AttachmentView[]>(() =>
  grouped.value.rest.map((att, i) => ({
    callId: att.callId,
    key: `${i}-${att.callId}-${att.name}`,
    name: att.name,
    contentType: att.contentType,
    url: attachmentUrl(att),
    isImage: att.contentType.startsWith('image/'),
    isVideo: att.contentType.startsWith('video/'),
    isText: isTextualMimeType(att.contentType),
  })),
)

// Sections like upstream: image diffs, then screenshots, then everything else.
const screenshots = computed(() => views.value.filter(a => a.isImage))
const others = computed(() => views.value.filter(a => !a.isImage))

const downloadFailed = reactive<Record<string, boolean>>({})

// Chromium never routes `<a download>` through the service worker, so fetch first.
async function download(att: AttachmentView): Promise<void> {
  if (!att.url)
    return
  try {
    const res = await fetch(att.url)
    if (!res.ok)
      throw new Error(`HTTP ${res.status}`)
    const body = await res.arrayBuffer()
    const href = URL.createObjectURL(new Blob([body], { type: att.contentType }))
    const a = document.createElement('a')
    a.href = href
    a.download = att.name
    a.click()
    setTimeout(() => URL.revokeObjectURL(href), 0)
    downloadFailed[att.key] = false
  }
  catch {
    downloadFailed[att.key] = true
  }
}

// Text attachments start collapsed and load when opened, like upstream; per trace, since keys repeat.
const expanded = ref(new Set<string>())
// null while loading.
const texts = reactive<Record<string, string | null>>({})
watch(() => store.model.value, () => {
  expanded.value = new Set()
  for (const key of Object.keys(texts))
    delete texts[key]
})

async function loadText(att: AttachmentView): Promise<void> {
  if (!att.url || texts[att.key] !== undefined)
    return
  texts[att.key] = null
  const model = store.model.value
  let text: string
  try {
    const res = await fetch(att.url)
    text = res.ok ? await res.text() : '<unavailable>'
  }
  catch {
    text = '<unavailable>'
  }
  if (model === store.model.value)
    texts[att.key] = text
}

function toggle(att: AttachmentView, open = !expanded.value.has(att.key)): void {
  const next = new Set(expanded.value)
  if (open) {
    next.add(att.key)
    void loadText(att)
  }
  else {
    next.delete(att.key)
  }
  expanded.value = next
}

function textLang(contentType: string): string {
  return contentType.includes('markdown') ? 'md' : bodyLang(contentType)
}

// Between 5 and 20 lines tall, like upstream's snippet.
function snippetHeight(text: string): string {
  const lines = text.split('\n').length
  return `${Math.min(Math.max(5, lines), 20) * 18 + 8}px`
}

const root = ref<HTMLElement | null>(null)
const flashing = ref<string>()

// `immediate`: the tab mounts after the reveal that opened it, so it would never see it change.
watch(() => store.attachmentReveal.value, async (reveal) => {
  if (!reveal)
    return
  // Consumed, so remounting the tab does not replay it.
  store.attachmentReveal.value = null
  // Unlike upstream, a revealed text attachment also opens, since that is what the user asked to see.
  for (const att of others.value) {
    if (att.callId === reveal.callId && att.isText && att.url)
      toggle(att, true)
  }
  await nextTick()
  const el = root.value?.querySelector<HTMLElement>(`[data-call-id="${CSS.escape(reveal.callId)}"]`)
  el?.scrollIntoView({ block: 'nearest' })
  flashing.value = reveal.callId
  setTimeout(() => {
    if (flashing.value === reveal.callId)
      flashing.value = undefined
  }, 1200)
}, { immediate: true })
</script>

<template>
  <div ref="root" class="h-full overflow-auto p-3">
    <div v-if="!views.length && !diffs.length" class="flex h-full items-center justify-center text-sm text-muted-foreground">
      No attachments
    </div>
    <div v-else class="flex flex-col gap-3">
      <template v-if="diffs.length">
        <h3 data-testid="attachments-section" class="text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
          Image diff
        </h3>
        <div v-for="d in diffs" :key="`diff-${d.callId}-${d.name}`" :data-call-id="d.callId" class="overflow-hidden rounded-md border border-border transition-shadow" :class="[flashing === d.callId && 'ring-2 ring-signal']">
          <div class="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
            <Paperclip class="size-3.5 text-muted-foreground" />
            <span class="text-xs font-medium">{{ d.name }}</span>
            <span class="font-mono text-[10px] text-muted-foreground">image diff</span>
          </div>
          <ImageDiff :name="d.name" :expected="d.expected" :actual="d.actual" :diff="d.diff" />
        </div>
      </template>

      <template v-for="section in [{ title: 'Screenshots', items: screenshots }, { title: 'Attachments', items: others }]" :key="section.title">
        <template v-if="section.items.length">
          <h3 data-testid="attachments-section" class="mt-1 text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            {{ section.title }}
          </h3>
          <div
            v-for="a in section.items"
            :key="a.key"
            data-testid="attachment"
            :data-call-id="a.callId"
            :data-flash="flashing === a.callId || undefined"
            class="overflow-hidden rounded-md border border-border transition-shadow"
            :class="[flashing === a.callId && 'ring-2 ring-signal']"
          >
            <div :class="cn('flex items-center gap-2 bg-muted/40 px-3 py-1.5', (!a.isText || expanded.has(a.key)) && 'border-b border-border')">
              <button
                v-if="a.isText && a.url"
                type="button"
                data-testid="attachment-toggle"
                :aria-expanded="expanded.has(a.key)"
                class="flex min-w-0 items-center gap-2 text-left"
                @click="toggle(a)"
              >
                <ChevronRight :class="cn('size-3.5 shrink-0 text-muted-foreground transition-transform', expanded.has(a.key) && 'rotate-90')" />
                <span class="truncate text-xs font-medium">{{ a.name }}</span>
              </button>
              <template v-else>
                <Paperclip class="size-3.5 shrink-0 text-muted-foreground" />
                <span class="truncate text-xs font-medium">{{ a.name }}</span>
              </template>
              <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{{ a.contentType }}</span>
              <div class="ml-auto flex shrink-0 items-center gap-3">
                <a
                  v-if="a.isImage && a.url"
                  data-testid="attachment-open"
                  :href="a.url"
                  target="_blank"
                  rel="noreferrer"
                  class="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink class="size-3" /> open
                </a>
                <button
                  v-if="a.url"
                  type="button"
                  data-testid="attachment-download"
                  class="flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                  @click="download(a)"
                >
                  <Download class="size-3" /> {{ downloadFailed[a.key] ? 'unavailable' : 'download' }}
                </button>
              </div>
            </div>
            <div v-if="a.isImage && a.url" class="p-3">
              <img :src="a.url" :alt="a.name" class="max-h-80 rounded border border-border">
            </div>
            <div v-else-if="a.isVideo && a.url" class="p-3">
              <video :src="a.url" controls class="max-h-80 rounded border border-border" />
            </div>
            <template v-else-if="a.isText">
              <div v-if="expanded.has(a.key)" data-testid="attachment-text">
                <div v-if="texts[a.key] == null" class="px-3 py-2 text-xs text-muted-foreground italic">
                  Loading…
                </div>
                <div v-else :style="{ height: snippetHeight(texts[a.key]!) }">
                  <CodeView :code="texts[a.key]!" :lang="textLang(a.contentType)" />
                </div>
              </div>
            </template>
            <div v-else class="p-3">
              <span class="text-xs text-muted-foreground">No preview</span>
            </div>
          </div>
        </template>
      </template>
    </div>
  </div>
</template>
