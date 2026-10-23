<script setup lang="ts">
import { asLocatorDescription } from '@isomorphic/locatorGenerators'
import { Check, Copy } from '@lucide/vue'
import { computed, ref } from 'vue'
import { useTraceStore } from '../store'

const store = useTraceStore()
const copied = ref<'locator' | 'selector' | null>(null)

const source = computed(() => store.pickedLocator.value ? 'Snapshot picker' : 'Selected action')

const selector = computed(() => {
  if (store.pickedLocator.value)
    return store.pickedLocator.value.selector
  const params = store.activeAction.value?.params ?? {}
  const value = params.selector ?? params.locator?.selector
  return typeof value === 'string' ? value : ''
})

const locator = computed(() => {
  if (store.pickedLocator.value)
    return store.pickedLocator.value.locator
  if (!selector.value)
    return ''
  try {
    return asLocatorDescription(store.model.value?.sdkLanguage ?? 'javascript', selector.value)
  }
  catch {
    return ''
  }
})

async function copyValue(kind: 'locator' | 'selector', value: string): Promise<void> {
  if (!value)
    return
  await navigator.clipboard.writeText(value)
  copied.value = kind
  setTimeout(() => {
    if (copied.value === kind)
      copied.value = null
  }, 1500)
}
</script>

<template>
  <div class="h-full overflow-auto p-3">
    <div v-if="!selector" class="flex h-full items-center justify-center text-sm text-muted-foreground">
      No locator for this action
    </div>
    <div v-else class="flex max-w-3xl flex-col gap-4">
      <div class="rounded-md border border-border bg-muted/20 px-3 py-2 text-xs">
        <span class="font-semibold text-foreground">Source</span>
        <span class="text-muted-foreground">: </span>
        <span data-testid="locator-source" class="text-foreground/90">{{ source }}</span>
      </div>

      <section>
        <div class="mb-1.5 flex items-center gap-2">
          <h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
            Generated locator
          </h3>
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
        <pre data-testid="locator-value" class="overflow-auto rounded-md border border-border bg-muted/30 p-3 font-mono text-xs text-foreground/90">{{ locator || selector }}</pre>
      </section>

      <section>
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
    </div>
  </div>
</template>
