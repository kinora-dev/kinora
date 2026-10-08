<script setup lang="ts">
import { Button } from '@kinora/ui/button'
import { RotateCw } from '@lucide/vue'
import { computed } from 'vue'
import { describeError } from '@/lib/errors'

// The failed-load block of a page: what happened, the raw detail for diagnosis, and a way to retry.
const props = defineProps<{ error: unknown }>()
defineEmits<{ retry: [] }>()

const info = computed(() => describeError(props.error))
</script>

<template>
  <div role="alert" class="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-fail/30 bg-fail/5 px-5 py-4">
    <div class="min-w-0">
      <p class="text-sm font-medium text-fail">
        {{ info.title }}
      </p>
      <p class="mt-1 break-words font-mono text-xs text-muted-foreground">
        {{ info.detail }}
      </p>
    </div>
    <Button v-if="info.retryable" variant="outline" size="sm" class="shrink-0 font-mono text-xs" @click="$emit('retry')">
      <RotateCw class="size-3.5" /> Retry
    </Button>
  </div>
</template>
