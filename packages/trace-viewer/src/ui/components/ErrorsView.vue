<script setup lang="ts">
import { Check, CircleAlert, Copy, FileSearch } from '@lucide/vue'
import { computed, ref, watchEffect } from 'vue'
import { actionTitleParts } from '../lib/action'
import { copyText } from '../lib/clipboard'
import { errorLocation, uniqueErrors } from '../lib/errors'
import { useTraceStore } from '../store'
import AnsiText from './AnsiText.vue'

const store = useTraceStore()

const errors = computed(() => uniqueErrors(store.model.value).map(e => ({
  key: e.message,
  message: e.message,
  title: e.action ? actionTitleParts(e.action, store.model.value?.sdkLanguage) : undefined,
  location: errorLocation(e),
  actionId: e.action?.callId,
  stack: e.stack ?? e.action?.stack ?? [],
})))

function revealErrorSource(error: typeof errors.value[number]): void {
  if (error.actionId)
    store.select(error.actionId)
  if (error.stack.length)
    store.revealSource(error.stack)
  else
    store.setDetailTab('source')
}

// Playwright attaches an `error-context` markdown blob (test info + error + ARIA
// snapshot + code frame) shaped for an LLM. Surface it as a one-click "Copy prompt".
const prompt = ref('')
const copied = ref(false)

watchEffect(async (onCleanup) => {
  let stale = false
  onCleanup(() => (stale = true))
  prompt.value = ''
  const m = store.model.value
  const att = m?.attachments.find(a => a.name === 'error-context')
  if (!m || !att)
    return
  const url = att.file
    ? m.createRelativeUrl(`file/${att.file}`)
    : att.base64
      ? `data:${att.contentType};base64,${att.base64}`
      : undefined
  if (!url)
    return
  try {
    const text = await (await fetch(url)).text()
    if (!stale)
      prompt.value = text
  }
  catch {}
})

async function copyPrompt(): Promise<void> {
  if (!await copyText(prompt.value))
    return
  copied.value = true
  setTimeout(() => (copied.value = false), 1500)
}
</script>

<template>
  <div class="flex h-full flex-col">
    <div v-if="prompt" class="flex shrink-0 justify-end border-b border-border px-3 py-2">
      <button
        type="button"
        class="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-signal/50 hover:text-foreground"
        @click="copyPrompt"
      >
        <component :is="copied ? Check : Copy" class="size-3.5" />
        {{ copied ? 'Copied' : 'Copy prompt' }}
      </button>
    </div>

    <div class="flex-1 overflow-y-auto p-3">
      <div v-if="!errors.length" class="flex h-full items-center justify-center text-sm text-muted-foreground">
        No errors in this trace
      </div>
      <div v-else class="flex flex-col gap-2">
        <div
          v-for="err in errors"
          :key="err.key"
          class="overflow-hidden rounded-md border border-fail/30 bg-fail/5"
        >
          <div class="flex min-w-0 items-center gap-2 border-b border-fail/20 bg-fail/10 px-3 py-1.5 text-xs">
            <CircleAlert class="size-3.5 shrink-0 text-fail" />
            <span v-if="err.title" data-testid="error-action" class="min-w-0 truncate font-medium text-fail">
              <span v-for="(part, i) in err.title.parts" :key="i" :class="part.param && 'text-info'">{{ part.text }}</span>
              <span v-if="err.title.subtitle" class="ml-1.5 font-normal text-fail/70">{{ err.title.subtitle }}</span>
            </span>
            <button
              v-if="err.location"
              type="button"
              data-testid="error-location"
              :title="err.location.full"
              :aria-label="`Go to source: ${err.location.full}`"
              class="shrink-0 font-mono text-[11px] text-fail/80 underline-offset-2 hover:text-fail hover:underline"
              @click="revealErrorSource(err)"
            >
              @ {{ err.location.short }}
            </button>
            <button
              v-else
              type="button"
              class="ml-auto inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-fail/80 transition-colors hover:bg-fail/10 hover:text-fail"
              @click="revealErrorSource(err)"
            >
              <FileSearch class="size-3.5" /> Reveal in source
            </button>
          </div>
          <pre data-testid="error-message" class="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap"><AnsiText :text="err.message" /></pre>
        </div>
      </div>
    </div>
  </div>
</template>
