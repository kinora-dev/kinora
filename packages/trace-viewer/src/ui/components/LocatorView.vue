<script setup lang="ts">
import type { TemplateError } from '../lib/ariaTemplate'
import { asLocator } from '@isomorphic/locatorGenerators'
import { locatorOrSelectorAsSelector } from '@isomorphic/locatorParser'
import { cn } from '@kinora/ui'
import { Check, Copy, RotateCcw, Target } from '@lucide/vue'
import { computed, defineAsyncComponent, onBeforeUnmount, ref, watch, watchEffect } from 'vue'
import { parseAriaTemplate } from '../lib/ariaTemplate'
import { copyText } from '../lib/clipboard'
import { matchStatus } from '../lib/locatorMatch'
import { useTraceStore } from '../store'

// Lazy like the Source tab's CodeView: CodeMirror stays out of the initial bundle.
const CodeEditor = defineAsyncComponent(() => import('./CodeEditor.vue'))

const store = useTraceStore()
const copied = ref<'locator' | 'selector' | 'aria' | null>(null)
const sdkLanguage = computed(() => store.model.value?.sdkLanguage ?? 'javascript')
const testIdAttributeName = computed(() => store.model.value?.testIdAttributeName ?? 'data-testid')

const actionLocator = computed(() => {
  const params = store.activeAction.value?.params ?? {}
  const selector = params.selector ?? params.locator?.selector
  if (typeof selector !== 'string' || !selector)
    return ''
  try {
    return asLocator(sdkLanguage.value, selector)
  }
  catch {
    return selector
  }
})

const source = computed(() => {
  if (store.editedLocator.value !== null)
    return 'Edited'
  return store.pickedLocator.value ? 'Snapshot picker' : 'Selected action'
})

// Like upstream, the snapshot highlights whichever editor was changed last.
const lastEdited = ref<'locator' | 'aria'>(store.editedAriaSnapshot.value !== null ? 'aria' : 'locator')
// A new pick replaces both editors, so its locator is what gets matched again.
watch(() => store.pickedLocator.value, () => (lastEdited.value = 'locator'))

const locator = computed({
  get: () => store.editedLocator.value ?? store.pickedLocator.value?.locator ?? actionLocator.value,
  set: (value) => {
    store.editedLocator.value = value
    lastEdited.value = 'locator'
    store.setInspectingLocator(false)
  },
})

const ariaSnapshot = computed({
  get: () => store.editedAriaSnapshot.value ?? store.pickedLocator.value?.ariaSnapshot ?? '',
  set: (value) => {
    store.editedAriaSnapshot.value = value
    lastEdited.value = 'aria'
    store.setInspectingLocator(false)
  },
})

const selector = computed(() => locator.value.trim() ? locatorOrSelectorAsSelector(sdkLanguage.value, locator.value, testIdAttributeName.value) : '')
const queryKind = computed(() => lastEdited.value === 'aria' && ariaSnapshot.value.trim() ? 'aria' : 'locator')

// While this tab is open, the snapshot highlights what the active editor matches.
watchEffect(() => {
  store.snapshotQuery.value = queryKind.value === 'aria'
    ? { kind: 'aria', text: ariaSnapshot.value }
    : { kind: 'locator', text: locator.value }
})
onBeforeUnmount(() => {
  store.snapshotQuery.value = null
  store.queryMatches.value = null
})

const ariaErrors = ref<TemplateError[]>([])
watch(ariaSnapshot, async (text) => {
  const errors = text.trim() ? (await parseAriaTemplate(text)).errors : []
  if (text === ariaSnapshot.value)
    ariaErrors.value = errors
}, { immediate: true })

const status = computed(() => {
  const matches = store.queryMatches.value
  if (matches === null)
    return undefined
  if (!store.currentSnapshotUrl.value)
    return { tone: 'muted', label: 'No DOM snapshot to match against' }
  return matchStatus(matches, queryKind.value)
})

const toneClass: Record<string, string> = {
  fail: 'border-fail/30 bg-fail/10 text-fail',
  flaky: 'border-flaky/30 bg-flaky/10 text-flaky',
  muted: 'border-border bg-muted/30 text-muted-foreground',
  pass: 'border-pass/30 bg-pass/10 text-pass',
}

function resetLocator(): void {
  store.editedLocator.value = null
  lastEdited.value = 'locator'
}

function resetAria(): void {
  store.editedAriaSnapshot.value = null
  lastEdited.value = 'locator'
}

async function copyValue(kind: 'locator' | 'selector' | 'aria', value: string): Promise<void> {
  if (!value)
    return
  if (!await copyText(value))
    return
  copied.value = kind
  setTimeout(() => {
    if (copied.value === kind)
      copied.value = null
  }, 1500)
}
</script>

<template>
  <div class="h-full overflow-auto p-3">
    <div class="flex max-w-3xl flex-col gap-4">
      <section>
        <div class="mb-1.5 flex items-center gap-2">
          <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Locator
          </h3>
          <span data-testid="locator-source" class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{{ source }}</span>
          <button
            type="button"
            title="Pick locator"
            :class="cn(
              'flex size-6 items-center justify-center rounded-md transition-colors',
              store.inspectingLocator.value ? 'bg-signal/15 text-signal' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )"
            @click="store.setInspectingLocator(!store.inspectingLocator.value)"
          >
            <Target class="size-3.5" />
          </button>
          <button
            v-if="store.editedLocator.value !== null"
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Back to the generated locator"
            @click="resetLocator"
          >
            <RotateCcw class="size-3" />
            Reset
          </button>
          <button
            v-if="locator"
            type="button"
            class="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-signal/50 hover:text-foreground"
            @click="copyValue('locator', locator)"
          >
            <component :is="copied === 'locator' ? Check : Copy" class="size-3.5" />
            {{ copied === 'locator' ? 'Copied' : 'Copy locator' }}
          </button>
        </div>
        <CodeEditor
          v-model="locator"
          data-testid="locator-value"
          :lang="sdkLanguage"
          placeholder="Type a locator, or pick one in the snapshot"
        />
        <div
          v-if="status && queryKind === 'locator'"
          data-testid="locator-matches"
          :data-tone="status.tone"
          :class="cn('mt-2 flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-xs', toneClass[status.tone])"
        >
          <span class="font-medium">{{ status.label }}</span>
          <span v-if="'hint' in status && status.hint" class="text-foreground/70">{{ status.hint }}</span>
        </div>
      </section>

      <section v-if="selector">
        <div class="mb-1.5 flex items-center gap-2">
          <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Raw selector
          </h3>
          <button
            type="button"
            class="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-signal/50 hover:text-foreground"
            @click="copyValue('selector', selector)"
          >
            <component :is="copied === 'selector' ? Check : Copy" class="size-3.5" />
            {{ copied === 'selector' ? 'Copied' : 'Copy selector' }}
          </button>
        </div>
        <pre data-testid="selector-value" class="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs text-foreground/90">{{ selector }}</pre>
      </section>
      <section>
        <div class="mb-1.5 flex items-center gap-2">
          <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            ARIA snapshot
          </h3>
          <span v-if="store.editedAriaSnapshot.value !== null" data-testid="aria-source" class="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">Edited</span>
          <button
            v-if="store.editedAriaSnapshot.value !== null"
            type="button"
            class="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            title="Back to the picked element's ARIA snapshot"
            @click="resetAria"
          >
            <RotateCcw class="size-3" />
            Reset
          </button>
          <button
            v-if="ariaSnapshot"
            type="button"
            class="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-xs text-muted-foreground transition-colors hover:border-signal/50 hover:text-foreground"
            @click="copyValue('aria', ariaSnapshot)"
          >
            <component :is="copied === 'aria' ? Check : Copy" class="size-3.5" />
            {{ copied === 'aria' ? 'Copied' : 'Copy snapshot' }}
          </button>
        </div>
        <CodeEditor
          v-model="ariaSnapshot"
          data-testid="aria-template"
          :errors="ariaErrors"
          placeholder="Pick an element to see its ARIA snapshot, or type a template to find matching elements"
        />
        <ul v-if="ariaErrors.length" data-testid="aria-template-errors" class="mt-2 flex flex-col gap-1 text-xs text-fail">
          <li v-for="(error, i) in ariaErrors" :key="i">
            <span class="font-mono">{{ error.line }}:{{ error.column }}</span> {{ error.message }}
          </li>
        </ul>
        <div
          v-else-if="status && queryKind === 'aria'"
          data-testid="aria-matches"
          :data-tone="status.tone"
          :class="cn('mt-2 flex items-baseline gap-2 rounded-md border px-2.5 py-1.5 text-xs', toneClass[status.tone])"
        >
          <span class="font-medium">{{ status.label }}</span>
          <span v-if="'hint' in status && status.hint" class="text-foreground/70">{{ status.hint }}</span>
        </div>
      </section>
    </div>
  </div>
</template>
