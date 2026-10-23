<script setup lang="ts">
import type { NetworkRow } from '../lib/network'
import { cn } from '@kinora/ui'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@kinora/ui/dropdown-menu'
import { Braces, ChevronDown, ChevronRight, Copy, X } from '@lucide/vue'
import { useStorage } from '@vueuse/core'
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch } from 'vue'
import { getAPIRequestCodeGen } from '../../core/ui/codegen'
import { formatMs } from '../lib/format'
import { bodyLang, bodyUrl, formatBody, formatSize, isTextMime, statusClass, statusLabel, toCurl, toFetch } from '../lib/network'
import { useTraceStore } from '../store'

const props = defineProps<{ row: NetworkRow }>()
const emit = defineEmits<{ close: [] }>()

// Lazy like the Source tab: CodeMirror only loads once a body is shown.
const CodeView = defineAsyncComponent(() => import('./CodeView.vue'))

const store = useTraceStore()

type DetailTab = 'headers' | 'payload' | 'response'
const TABS: { id: DetailTab, label: string }[] = [
  { id: 'headers', label: 'Headers' },
  { id: 'payload', label: 'Payload' },
  { id: 'response', label: 'Response' },
]
const tab = useStorage<DetailTab>('kinora-tv-net-detail-tab', 'headers')
const collapsedSections = useStorage<string[]>('kinora-tv-net-collapsed-sections', [])
const prettyPayload = useStorage('kinora-tv-net-pretty-payload', true)
const prettyResponse = useStorage('kinora-tv-net-pretty-response', true)

function toggleSection(id: string): void {
  collapsedSections.value = collapsedSections.value.includes(id)
    ? collapsedSections.value.filter(s => s !== id)
    : [...collapsedSections.value, id]
}

const resource = computed(() => props.row.resource)

const general = computed(() => [
  { name: 'URL', value: props.row.url },
  { name: 'Method', value: props.row.method },
  { name: 'Status Code', value: `${statusLabel(props.row.status)} ${resource.value.response?.statusText ?? ''}`.trim(), class: statusClass(props.row.status) },
  { name: 'Start', value: formatMs(props.row.start), testid: 'net-started' },
  { name: 'Duration', value: formatMs(props.row.duration) },
  { name: 'Size', value: formatSize(props.row.size) },
  { name: 'Content Type', value: props.row.contentType },
  ...(props.row.route ? [{ name: 'Route', value: props.row.route, class: props.row.route === 'aborted' ? 'text-fail' : 'text-info' }] : []),
].filter(entry => entry.value))

const sections = computed(() => ({
  headers: [
    { id: 'general', title: 'General', rows: general.value, count: false },
    { id: 'request-headers', title: 'Request Headers', rows: resource.value.request.headers ?? [], count: true },
    { id: 'response-headers', title: 'Response Headers', rows: resource.value.response?.headers ?? [], count: true },
  ],
  query: { id: 'query', title: 'Query String Parameters', rows: resource.value.request.queryString ?? [], count: true },
}))

interface Body { text?: string, mime: string, imageUrl?: string, font?: ArrayBuffer, downloadUrl?: string }
const requestBody = ref<Body>()
const responseBody = ref<Body>()
const BODY_LIMIT = 200_000

function headerValue(headers: { name: string, value: string }[] | undefined, name: string): string {
  return headers?.find(h => h.name.toLowerCase() === name)?.value ?? ''
}

async function loadRequestBody(): Promise<Body | undefined> {
  const postData = resource.value.request.postData
  if (!postData)
    return undefined
  const mime = postData.mimeType || headerValue(resource.value.request.headers, 'content-type')
  if (postData.text)
    return { text: postData.text.slice(0, BODY_LIMIT), mime }
  const url = bodyUrl(store.model.value, postData._file)
  if (!url)
    return undefined
  if (!isTextMime(mime.toLowerCase()))
    return { mime, downloadUrl: url }
  return { text: (await (await fetch(url)).text()).slice(0, BODY_LIMIT), mime }
}

async function loadResponseBody(): Promise<Body | undefined> {
  const content = resource.value.response?.content
  const mime = content?.mimeType ?? ''
  const url = bodyUrl(store.model.value, content?._file)
  if (!url)
    return content?.text ? { text: content.text.slice(0, BODY_LIMIT), mime } : undefined
  const m = mime.toLowerCase()
  if (m.startsWith('image/'))
    return { mime, imageUrl: url }
  if (m.includes('font'))
    return { mime, font: await (await fetch(url)).arrayBuffer() }
  if (!isTextMime(m))
    return { mime, downloadUrl: url }
  return { text: (await (await fetch(url)).text()).slice(0, BODY_LIMIT), mime }
}

watch(resource, async (r) => {
  requestBody.value = undefined
  responseBody.value = undefined
  const [req, res] = await Promise.all([loadRequestBody().catch(() => undefined), loadResponseBody().catch(() => undefined)])
  if (r !== resource.value)
    return
  requestBody.value = req
  responseBody.value = res
}, { immediate: true })

function formatted(body: Body | undefined, pretty: boolean): { text: string, error?: boolean } {
  if (body?.text === undefined)
    return { text: '' }
  if (!pretty)
    return { text: body.text }
  try {
    return { text: formatBody(body.text, body.mime) }
  }
  catch {
    return { text: body.text, error: true }
  }
}

const payloadText = computed(() => formatted(requestBody.value, prettyPayload.value))
const responseText = computed(() => formatted(responseBody.value, prettyResponse.value))

// Each preview gets its own family name so two fonts never overwrite each other.
let fontFace: FontFace | undefined
let fontSeq = 0
const fontFamily = ref('')
const fontError = ref(false)
watch(() => responseBody.value?.font, (font) => {
  if (fontFace)
    document.fonts.delete(fontFace)
  fontFace = undefined
  fontError.value = false
  if (!font)
    return
  try {
    fontFamily.value = `kinora-font-preview-${++fontSeq}`
    fontFace = new FontFace(fontFamily.value, font)
    void fontFace.load().then(face => document.fonts.add(face)).catch(() => (fontError.value = true))
  }
  catch {
    fontError.value = true
  }
})
onBeforeUnmount(() => fontFace && document.fonts.delete(fontFace))

function copy(text: string): void {
  void navigator.clipboard.writeText(text)
}

function copyAsPlaywright(): void {
  const codegen = getAPIRequestCodeGen(store.model.value?.sdkLanguage ?? 'javascript')
  copy(codegen.generatePlaywrightRequestCall(resource.value.request, requestBody.value?.text))
}
</script>

<template>
  <div data-testid="net-detail" class="flex h-full flex-col text-xs">
    <div class="flex h-9 shrink-0 items-center gap-1 border-b border-border px-1.5">
      <button
        type="button"
        title="Close"
        class="flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        @click="emit('close')"
      >
        <X class="size-3.5" />
      </button>
      <div class="flex items-center gap-0.5 rounded-md bg-muted/60 p-0.5">
        <button
          v-for="t in TABS"
          :key="t.id"
          type="button"
          :data-testid="`net-tab-${t.id}`"
          :class="cn(
            'rounded px-2 py-0.5 text-[11px] font-medium transition-colors',
            tab === t.id ? 'bg-card text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
          )"
          @click="tab = t.id"
        >
          {{ t.label }}
        </button>
      </div>
      <DropdownMenu>
        <DropdownMenuTrigger
          class="ml-auto inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          title="Copy"
        >
          <Copy class="size-3.5" />
          Copy
          <ChevronDown class="size-3" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem @click="copy(row.url)">
            Copy URL
          </DropdownMenuItem>
          <DropdownMenuItem @click="copy(toCurl(resource))">
            Copy as cURL
          </DropdownMenuItem>
          <DropdownMenuItem @click="copy(toFetch(resource))">
            Copy as fetch
          </DropdownMenuItem>
          <DropdownMenuItem @click="copyAsPlaywright">
            Copy as Playwright
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <!-- Headers -->
    <div v-if="tab === 'headers'" class="min-h-0 flex-1 overflow-auto p-2">
      <section v-for="section in sections.headers" :key="section.id" :data-testid="`net-section-${section.id}`" class="mb-2">
        <button
          type="button"
          class="flex w-full items-center gap-1 rounded px-1 py-1 text-left font-semibold text-foreground/90 hover:bg-muted/50"
          @click="toggleSection(section.id)"
        >
          <ChevronRight :class="cn('size-3.5 text-muted-foreground transition-transform', !collapsedSections.includes(section.id) && 'rotate-90')" />
          {{ section.title }}
          <span v-if="section.count" class="font-normal text-muted-foreground">× {{ section.rows.length }}</span>
        </button>
        <table v-if="!collapsedSections.includes(section.id)" class="ml-5 w-[calc(100%-1.25rem)] font-mono">
          <tbody>
            <tr v-for="(entry, i) in section.rows" :key="i" class="align-top">
              <td class="max-w-48 py-0.5 pr-3 whitespace-nowrap text-muted-foreground">
                {{ entry.name }}
              </td>
              <td :data-testid="'testid' in entry ? entry.testid : undefined" :class="cn('py-0.5 break-all text-foreground/90', 'class' in entry && entry.class)">
                {{ entry.value }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>

    <!-- Payload -->
    <div v-else-if="tab === 'payload'" class="flex min-h-0 flex-1 flex-col overflow-auto p-2">
      <em v-if="!sections.query.rows.length && !resource.request.postData" class="p-1 text-muted-foreground">No payload for this request.</em>
      <section v-if="sections.query.rows.length" data-testid="net-section-query" class="mb-2">
        <button
          type="button"
          class="flex w-full items-center gap-1 rounded px-1 py-1 text-left font-semibold text-foreground/90 hover:bg-muted/50"
          @click="toggleSection('query')"
        >
          <ChevronRight :class="cn('size-3.5 text-muted-foreground transition-transform', !collapsedSections.includes('query') && 'rotate-90')" />
          {{ sections.query.title }}
          <span class="font-normal text-muted-foreground">× {{ sections.query.rows.length }}</span>
        </button>
        <table v-if="!collapsedSections.includes('query')" class="ml-5 w-[calc(100%-1.25rem)] font-mono">
          <tbody>
            <tr v-for="(entry, i) in sections.query.rows" :key="i" class="align-top">
              <td class="max-w-48 py-0.5 pr-3 whitespace-nowrap text-muted-foreground">
                {{ entry.name }}
              </td>
              <td class="py-0.5 break-all text-foreground/90">
                {{ entry.value }}
              </td>
            </tr>
          </tbody>
        </table>
      </section>
      <section v-if="requestBody" class="flex min-h-48 flex-1 flex-col">
        <div class="flex items-center gap-1 px-1 py-1">
          <span class="font-semibold text-foreground/90">Request body</span>
          <span v-if="payloadText.error" class="text-[11px] text-fail">Formatting failed</span>
          <button
            v-if="requestBody.text !== undefined"
            type="button"
            title="Pretty print"
            :aria-pressed="prettyPayload"
            :class="cn('ml-auto flex size-6 items-center justify-center rounded transition-colors hover:bg-muted', prettyPayload ? 'text-signal' : 'text-muted-foreground')"
            @click="prettyPayload = !prettyPayload"
          >
            <Braces class="size-3.5" />
          </button>
        </div>
        <div v-if="requestBody.text !== undefined" data-testid="net-request-body" class="min-h-0 flex-1 overflow-hidden rounded border border-border">
          <CodeView :code="payloadText.text" :lang="bodyLang(requestBody.mime)" />
        </div>
        <a v-else-if="requestBody.downloadUrl" :href="requestBody.downloadUrl" download class="px-1 text-muted-foreground hover:text-foreground">download body</a>
      </section>
    </div>

    <!-- Response -->
    <div v-else class="flex min-h-0 flex-1 flex-col overflow-auto p-2">
      <div v-if="!responseBody" class="p-1 text-muted-foreground">
        Response body is not available for this request.
      </div>
      <template v-else>
        <div v-if="responseBody.text !== undefined" class="flex items-center gap-1 px-1 pb-1">
          <span class="font-semibold text-foreground/90">Response body</span>
          <span v-if="responseText.error" class="text-[11px] text-fail">Formatting failed</span>
          <button
            type="button"
            title="Pretty print"
            :aria-pressed="prettyResponse"
            :class="cn('ml-auto flex size-6 items-center justify-center rounded transition-colors hover:bg-muted', prettyResponse ? 'text-signal' : 'text-muted-foreground')"
            @click="prettyResponse = !prettyResponse"
          >
            <Braces class="size-3.5" />
          </button>
        </div>
        <div v-if="responseBody.text !== undefined" data-testid="net-response-body" class="min-h-48 flex-1 overflow-hidden rounded border border-border">
          <CodeView :code="responseText.text" :lang="bodyLang(responseBody.mime)" />
        </div>
        <img v-else-if="responseBody.imageUrl" :src="responseBody.imageUrl" alt="Response image" class="max-h-80 self-start rounded border border-border">
        <div v-else-if="responseBody.font" data-testid="net-font-preview" class="p-2 text-3xl leading-snug" :style="{ fontFamily: fontError ? undefined : fontFamily }">
          <template v-if="fontError">
            <span class="text-sm text-muted-foreground">Could not load font preview</span>
          </template>
          <template v-else>
            ABCDEFGHIJKLM<br>NOPQRSTUVWXYZ<br>abcdefghijklm<br>nopqrstuvwxyz<br>1234567890
          </template>
        </div>
        <a v-else-if="responseBody.downloadUrl" :href="responseBody.downloadUrl" download class="px-1 text-muted-foreground hover:text-foreground">download body</a>
      </template>
    </div>
  </div>
</template>
