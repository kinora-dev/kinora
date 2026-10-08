<script setup lang="ts">
import type { AvatarImageProps } from 'reka-ui'
import { AvatarImage, useForwardProps } from 'reka-ui'

const props = defineProps<AvatarImageProps>()

const forwardedProps = useForwardProps(props)
</script>

<template>
  <AvatarImage
    data-slot="avatar-image"
    v-bind="forwardedProps"
    class="aspect-square size-full"
  />
</template>
