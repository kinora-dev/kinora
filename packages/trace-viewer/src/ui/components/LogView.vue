<script setup lang="ts">
import { computed } from 'vue'
import { actionLogLines } from '../lib/action'
import { useTraceStore } from '../store'

const store = useTraceStore()

const lines = computed(() => store.activeAction.value ? actionLogLines(store.activeAction.value) : [])
</script>

<template>
  <div class="h-full overflow-auto py-1">
    <div v-if="!lines.length" class="flex h-full items-center justify-center text-sm text-muted-foreground">
      No log for this action
    </div>
    <div
      v-for="(line, i) in lines"
      :key="i"
      data-testid="log-line"
      class="flex gap-3 border-l-2 border-l-transparent px-3 py-0.5 font-mono text-xs text-foreground/80"
    >
      <span data-testid="log-duration" class="w-14 shrink-0 text-right tabular-nums text-muted-foreground">{{ line.duration }}</span>
      <span class="min-w-0 break-words">{{ line.message }}</span>
    </div>
  </div>
</template>
