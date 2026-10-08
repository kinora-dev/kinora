<script setup lang="ts">
import type { PaginationListItemProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import type { ButtonVariants } from '../button'
import { reactiveOmit } from '@vueuse/core'
import { PaginationListItem, useForwardProps } from 'reka-ui'
import { cn } from '../../../lib/utils'
import { buttonVariants } from '../button'

const props = withDefaults(defineProps<PaginationListItemProps & {
  size?: ButtonVariants['size']
  class?: HTMLAttributes['class']
  isActive?: boolean
}>(), {
  size: 'icon',
})

const delegatedProps = reactiveOmit(props, 'class', 'size', 'isActive')
const forwardedProps = useForwardProps(delegatedProps)
</script>

<template>
  <PaginationListItem
    data-slot="pagination-item"
    v-bind="forwardedProps"
    :class="cn(
      buttonVariants({
        variant: isActive ? 'outline' : 'ghost',
        size,
      }),
      props.class)"
  >
    <slot />
  </PaginationListItem>
</template>
