<script setup lang="ts">
import type { Attachment } from '@isomorphic/trace/traceModel'
import { Download, Paperclip } from '@lucide/vue'
import { computed, reactive, watchEffect } from 'vue'
import { groupImageDiffs } from '../lib/attachments'
import { useTraceStore } from '../store'
import ImageDiff from './ImageDiff.vue'

const store = useTraceStore()

interface AttachmentView {
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
    name: g.name,
    expected: g.expected && attachmentUrl(g.expected),
    actual: g.actual && attachmentUrl(g.actual),
    diff: g.diff && attachmentUrl(g.diff),
  })),
)

const attachments = computed<AttachmentView[]>(() =>
  grouped.value.rest.map((att, i) => ({
    key: `${i}-${att.name}`,
    name: att.name,
    contentType: att.contentType,
    url: attachmentUrl(att),
    isImage: att.contentType.startsWith('image/'),
    isVideo: att.contentType.startsWith('video/'),
    isText: att.contentType.startsWith('text/') || att.contentType.includes('json') || att.contentType.includes('xml'),
  })),
)

const downloadFailed = reactive<Record<string, boolean>>({})

// Chromium never routes `<a download>` through the service worker, so fetch first.
async function download(att: AttachmentView): Promise<void> {
  if (!att.url)
    return
  try {
    const body = await (await fetch(att.url)).arrayBuffer()
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

// Lazily fetch textual attachment contents.
const texts = reactive<Record<string, string>>({})

async function loadText(key: string, url: string): Promise<void> {
  try {
    texts[key] = await (await fetch(url)).text()
  }
  catch {
    texts[key] = '<unavailable>'
  }
}

watchEffect(() => {
  for (const a of attachments.value) {
    if (a.isText && a.url && texts[a.key] === undefined) {
      texts[a.key] = ''
      void loadText(a.key, a.url)
    }
  }
})
</script>

<template>
  <div class="h-full overflow-auto p-3">
    <div v-if="!attachments.length && !diffs.length" class="flex h-full items-center justify-center text-sm text-muted-foreground">
      No attachments
    </div>
    <div v-else class="flex flex-col gap-3">
      <div v-for="d in diffs" :key="`diff-${d.name}`" class="overflow-hidden rounded-md border border-border">
        <div class="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
          <Paperclip class="size-3.5 text-muted-foreground" />
          <span class="text-xs font-medium">{{ d.name }}</span>
          <span class="font-mono text-[10px] text-muted-foreground">image diff</span>
        </div>
        <ImageDiff :name="d.name" :expected="d.expected" :actual="d.actual" :diff="d.diff" />
      </div>

      <div v-for="a in attachments" :key="a.key" data-testid="attachment" class="overflow-hidden rounded-md border border-border">
        <div class="flex items-center gap-2 border-b border-border bg-muted/40 px-3 py-1.5">
          <Paperclip class="size-3.5 text-muted-foreground" />
          <span class="text-xs font-medium">{{ a.name }}</span>
          <span class="font-mono text-[10px] text-muted-foreground">{{ a.contentType }}</span>
          <button
            v-if="a.url"
            type="button"
            data-testid="attachment-download"
            class="ml-auto flex cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
            @click="download(a)"
          >
            <Download class="size-3" /> {{ downloadFailed[a.key] ? 'unavailable' : 'download' }}
          </button>
        </div>
        <div class="p-3">
          <img v-if="a.isImage && a.url" :src="a.url" :alt="a.name" class="max-h-80 rounded border border-border">
          <video v-else-if="a.isVideo && a.url" :src="a.url" controls class="max-h-80 rounded border border-border" />
          <pre v-else-if="a.isText" class="overflow-auto font-mono text-xs whitespace-pre-wrap text-foreground/90">{{ texts[a.key] }}</pre>
          <span v-else class="text-xs text-muted-foreground">No preview</span>
        </div>
      </div>
    </div>
  </div>
</template>
