<script setup lang="ts">
import type { TooltipTriggerProps } from 'reka-ui'
import { TooltipTrigger, useForwardProps } from 'reka-ui'

const props = defineProps<TooltipTriggerProps>()

const forwardedProps = useForwardProps(props)
</script>

<template>
  <TooltipTrigger
    data-slot="tooltip-trigger"
    v-bind="forwardedProps"
  >
    <slot />
  </TooltipTrigger>
</template>
