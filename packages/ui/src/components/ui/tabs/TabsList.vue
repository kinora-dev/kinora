<script setup lang="ts">
import type { TabsListProps } from 'reka-ui'
import type { HTMLAttributes } from 'vue'
import { reactiveOmit } from '@vueuse/core'
import { TabsList } from 'reka-ui'
import { cn } from '../../../lib/utils'

// Vue casts an absent boolean prop to `false`, which would override Reka's own default
// when forwarded: keyboard navigation loops from the last tab back to the first.
const props = withDefaults(defineProps<TabsListProps & { class?: HTMLAttributes['class'] }>(), { loop: true })

const delegatedProps = reactiveOmit(props, 'class')
</script>

<template>
  <TabsList
    data-slot="tabs-list"
    v-bind="delegatedProps"
    :class="cn(
      'bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-0.75',
      props.class,
    )"
  >
    <slot />
  </TabsList>
</template>
