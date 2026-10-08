<script setup lang="ts">
import type { TooltipProviderProps } from 'reka-ui'
import { TooltipProvider, useForwardProps } from 'reka-ui'

const props = withDefaults(defineProps<TooltipProviderProps>(), {
  delayDuration: 0,
})

const forwardedProps = useForwardProps(props)
</script>

<template>
  <TooltipProvider v-bind="forwardedProps">
    <slot />
  </TooltipProvider>
</template>
