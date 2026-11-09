<script setup lang="ts" generic="T extends Record<string, unknown>">
import type { HTMLAttributes } from 'vue'
import type { ChartConfig } from '../chart'
import { CurveType } from '@unovis/ts'
import { VisAxis, VisLine, VisXYContainer } from '@unovis/vue'
import { usePreferredReducedMotion } from '@vueuse/core'
import { computed } from 'vue'
import { ChartContainer, ChartCrosshair, ChartTooltip, ChartTooltipContent, componentToString } from '../chart'

// Several series as lines on one time axis, e.g. flaky and failure rates per week. `series` lists
// config keys; each is also the datum field holding that series' value. Unlike a stacked chart,
// the y axis fits the data, so a rate moving from 1% to 4% reads as a real change.
const props = defineProps<{
  data: T[]
  x: (d: T, i: number) => number
  series: string[]
  config: ChartConfig
  xTickFormat?: (x: number) => string
  // Tooltip title; defaults to xTickFormat.
  xLabelFormat?: (x: number) => string
  // Formats a value on the y axis and in the tooltip, e.g. a rate as a percent.
  yFormat?: (y: number) => string
  xDomain?: [number, number]
  xTicks?: number[]
  class?: HTMLAttributes['class']
}>()

const still = usePreferredReducedMotion().value === 'reduce'
const y = computed(() => props.series.map(key => (d: T) => Number(d[key]) || 0))
// From zero, so a small rate does not read as a big one; some headroom keeps the peak off the top.
const yDomain = computed((): [number, number] => {
  const max = Math.max(0, ...props.data.flatMap(d => y.value.map(get => get(d))))
  return [0, max ? max * 1.2 : 1]
})
const color = (_: unknown, i: number) => `var(--color-${props.series[i]})`
const ticks = computed(() => props.xTicks ?? props.data.map(props.x))

const label = props.xLabelFormat ?? props.xTickFormat
const content = componentToString(props.config, ChartTooltipContent, {
  labelFormatter: label ? (d: number | Date) => label(Number(d)) : undefined,
})
function tooltip(d: T, x: number | Date) {
  const format = props.yFormat
  const shown = format ? { ...d, ...Object.fromEntries(props.series.map(k => [k, format(Number(d[k]) || 0)])) } : d
  return content?.(shown, x)
}
</script>

<template>
  <ChartContainer :config="config" :class="props.class" cursor>
    <VisXYContainer :data="data" :x-domain="xDomain" :y-domain="yDomain" :duration="still ? 0 : undefined">
      <VisLine :x="x" :y="y" :color="color" :curve-type="CurveType.MonotoneX" :line-width="2" />
      <VisAxis
        v-if="xTickFormat"
        type="x"
        :x="x"
        :tick-format="xTickFormat"
        :tick-values="ticks"
        tick-text-adaptive-sets
        :grid-line="false"
        :domain-line="false"
        :tick-line="false"
      />
      <VisAxis type="y" :tick-format="yFormat" :num-ticks="3" :domain-line="false" :tick-line="false" />
      <ChartTooltip />
      <ChartCrosshair :template="tooltip" :x="x" :y="y" :color="color" />
    </VisXYContainer>
  </ChartContainer>
</template>
