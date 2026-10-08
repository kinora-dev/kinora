<script setup lang="ts">
import { storyLabel } from '@kinora/core'
import { Blocks } from '@lucide/vue'
import { RouterLink } from 'vue-router'

// A component story a test mounted, linking to it on the Components page. The id may be a
// suffix of the full story id (Playwright accepts both), which the page's search still matches.
defineProps<{ projectId: string, storyId: string }>()
</script>

<template>
  <RouterLink
    :to="{ name: 'components', params: { projectId }, query: { q: storyId } }"
    :title="`Story ${storyId}`"
    class="inline-flex max-w-xs items-center gap-1 truncate rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground transition-colors hover:border-foreground/30 hover:text-foreground"
  >
    <Blocks class="size-3 shrink-0" />
    {{ storyLabel(storyId) }}
  </RouterLink>
</template>
