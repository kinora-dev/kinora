<script setup lang="ts">
import type { SelectValueProps } from 'reka-ui'
import { SelectValue, useForwardProps } from 'reka-ui'

const props = defineProps<SelectValueProps>()

const forwardedProps = useForwardProps(props)
</script>

<template>
  <SelectValue
    data-slot="select-value"
    v-bind="forwardedProps"
  >
    <slot />
  </SelectValue>
</template>
