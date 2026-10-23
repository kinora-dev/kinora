<script setup lang="ts">
import { cn } from '@kinora/ui'
import { Tooltip, TooltipContent, TooltipTrigger } from '@kinora/ui/tooltip'

defineOptions({ inheritAttrs: false })

const props = defineProps<{ text: string, tip?: string, class?: string }>()
</script>

<template>
  <Tooltip :delay-duration="300">
    <TooltipTrigger as-child>
      <span :class="cn('truncate', props.class)"><slot>{{ text }}</slot></span>
    </TooltipTrigger>
    <TooltipContent class="max-w-md break-all font-mono">
      {{ tip ?? text }}
    </TooltipContent>
  </Tooltip>
</template>
