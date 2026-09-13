<script setup lang="ts">
import { Button } from '@kinora/ui/button'
import { FileUp } from '@lucide/vue'
import { useTemplateRef } from 'vue'
import { useTraceStore } from '../store'

// `compact` renders the picker alone, for reuse under a load error.
withDefaults(defineProps<{ compact?: boolean }>(), { compact: false })

const store = useTraceStore()
const input = useTemplateRef<HTMLInputElement>('input')

function onPick(event: Event): void {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file)
    void store.loadFile(file)
}

function openDemo(): void {
  void store.load(new URL('fixtures/demo.zip', location.href).href, 'demo.zip')
}
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 text-center" :class="compact ? 'py-6' : 'h-full'">
    <input
      ref="input"
      type="file"
      accept=".zip,application/zip"
      class="hidden"
      data-testid="trace-file-input"
      @change="onPick"
    >

    <template v-if="!compact">
      <div class="flex size-12 items-center justify-center rounded-xl border border-border bg-muted/40">
        <FileUp class="size-5 text-muted-foreground" aria-hidden="true" />
      </div>
      <h1 class="mt-5 text-lg font-semibold tracking-tight">
        Open a Playwright trace
      </h1>
      <p class="mt-2 max-w-sm text-pretty text-sm text-muted-foreground">
        Drag a <code class="font-mono text-[13px]">trace.zip</code> anywhere on this page, or pick one below.
      </p>
    </template>

    <div class="flex flex-wrap items-center justify-center gap-3" :class="compact ? '' : 'mt-6'">
      <Button data-testid="choose-trace" @click="input?.click()">
        Choose trace.zip
      </Button>
      <Button variant="outline" data-testid="open-demo" @click="openDemo">
        Open a demo trace
      </Button>
    </div>

    <p v-if="!compact" class="mt-6 max-w-sm text-xs text-muted-foreground">
      The trace is read in your browser. Nothing is uploaded, and no account is needed.
    </p>
  </div>
</template>
