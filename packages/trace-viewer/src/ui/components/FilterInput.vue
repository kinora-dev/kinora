<script setup lang="ts">
import type { HTMLAttributes } from 'vue'
import { cn } from '@kinora/ui'
import { Search, X } from '@lucide/vue'

defineOptions({ inheritAttrs: false })
defineProps<{ placeholder?: string, class?: HTMLAttributes['class'] }>()
const model = defineModel<string>({ default: '' })
</script>

<template>
  <div :class="cn('flex items-center gap-1.5 rounded-md bg-muted/50 px-2 py-1', $props.class)">
    <Search class="size-3.5 shrink-0 text-muted-foreground" />
    <input
      v-model="model"
      v-bind="$attrs"
      :placeholder="placeholder"
      class="h-full w-full min-w-0 bg-transparent text-xs text-foreground outline-none placeholder:text-muted-foreground"
    >
    <button
      v-if="model"
      type="button"
      title="Clear"
      class="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
      @click="model = ''"
    >
      <X class="size-3.5" />
    </button>
  </div>
</template>
