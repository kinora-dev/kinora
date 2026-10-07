<script setup lang="ts">
import { Check, CircleAlert, Copy, FileSearch } from '@lucide/vue'
import { computed, ref, watchEffect } from 'vue'
import { stripAnsi } from '../lib/ansi'
import { useTraceStore } from '../store'

const store = useTraceStore()

const errors = computed(() => {
  const m = store.model.value
  if (!m)
    return []
  return m.errorDescriptors.map((e, i) => ({
    key: `${i}-${e.message}`,
    message: stripAnsi(e.message),
    where: e.action ? `${e.action.class}.${e.action.method}` : undefined,
    actionId: e.action?.callId,
    stack: e.stack ?? e.action?.stack ?? [],
  }))
})

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

watchEffect(async () => {
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
    prompt.value = await (await fetch(url)).text()
  }
  catch {
    prompt.value = ''
  }
})

async function copyPrompt(): Promise<void> {
  await navigator.clipboard.writeText(prompt.value)
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
          <div class="flex items-center gap-2 border-b border-fail/20 bg-fail/10 px-3 py-1.5">
            <CircleAlert class="size-3.5 text-fail" />
            <span v-if="err.where" class="font-mono text-xs text-fail">{{ err.where }}</span>
            <button
              type="button"
              class="ml-auto inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 font-mono text-[11px] text-fail/80 transition-colors hover:bg-fail/10 hover:text-fail"
              @click="revealErrorSource(err)"
            >
              <FileSearch class="size-3.5" /> Reveal in source
            </button>
          </div>
          <pre class="overflow-x-auto px-3 py-2 font-mono text-xs leading-relaxed text-foreground/90 whitespace-pre-wrap">{{ err.message }}</pre>
        </div>
      </div>
    </div>
  </div>
</template>
