<script setup lang="ts">
import type { NormTest } from '@kinora/core'
import { splitScreenshotComparisons } from '@kinora/core'
import { Button } from '@kinora/ui/button'
import { ImageIcon } from '@lucide/vue'
import { computed, ref } from 'vue'
import { describeError } from '@/lib/errors'
import { trpc } from '@/lib/trpc'
import ScreenshotDiff from './ScreenshotDiff.vue'

// The failed screenshot assertions of one test in one run, loaded only when asked for: a history
// lists many runs, and each image url is signed at read time.
const props = defineProps<{ projectId: string, runId: string, testKey: string, count: number }>()

const attachments = ref<NormTest['attachments']>()
const loading = ref(false)
const error = ref<unknown>()

const comparisons = computed(() => splitScreenshotComparisons(attachments.value ?? []).comparisons.filter(c => c.actual?.url))

async function load(): Promise<void> {
  loading.value = true
  error.value = undefined
  try {
    attachments.value = await trpc.dashboard.testAttachments.query({ projectId: props.projectId, runId: props.runId, testKey: props.testKey })
  }
  catch (err) {
    error.value = err
  }
  finally {
    loading.value = false
  }
}
</script>

<template>
  <div class="mt-2">
    <Button
      v-if="!attachments"
      variant="outline"
      size="sm"
      class="font-mono text-xs text-muted-foreground"
      :disabled="loading"
      @click="load"
    >
      <ImageIcon class="size-3.5" />
      {{ loading ? 'Loading screenshots...' : `Show screenshot ${count === 1 ? 'comparison' : `comparisons (${count})`}` }}
    </Button>
    <p v-if="error" class="mt-2 font-mono text-[11px] text-fail">
      {{ describeError(error).title }} {{ describeError(error).detail }}
    </p>
    <div v-else-if="attachments" class="flex flex-col gap-3">
      <ScreenshotDiff v-for="(c, i) in comparisons" :key="`${c.name}-${i}`" :comparison="c" />
      <p v-if="!comparisons.length" class="font-mono text-[11px] text-muted-foreground">
        The images of this run were not uploaded.
      </p>
    </div>
  </div>
</template>
