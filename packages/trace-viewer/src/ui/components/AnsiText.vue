<script setup lang="ts">
import { computed } from 'vue'
import { ansiSegments } from '../lib/ansi'

const props = defineProps<{ text: string }>()

// Playwright error messages carry terminal colours (expected/received); keep them, like upstream.
const segments = computed(() => ansiSegments(props.text))
</script>

<template>
  <span v-for="(segment, i) in segments" :key="i" :style="segment.style">{{ segment.text }}</span>
</template>
