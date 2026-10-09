<script setup lang="ts">
import type { LabelProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { Label, useForwardProps } from 'reka-ui'
import { cn } from '../../../lib/utils'

const props = defineProps<LabelProps & { class?: HTMLAttributes['class'] }>()
const delegated = reactiveOmit(props, 'class')
const forwardedProps = useForwardProps(delegated)
</script>

<template>
  <Label
    data-slot="label"
    v-bind="forwardedProps"
    :class="cn('flex items-center gap-2 text-sm font-medium leading-none select-none', props.class)"
  >
    <slot />
  </Label>
</template>
