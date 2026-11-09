import type { ChartConfig } from '../chart'
import { h } from 'vue'
import LineChart from './LineChart.vue'

// A type alias, not an interface: the chart wants a Record<string, unknown>.
// eslint-disable-next-line ts/consistent-type-definitions
type Bucket = { day: string, flaky: number, unexpected: number }

const DATA: Bucket[] = [
  { day: 'Oct 1', flaky: 0.01, unexpected: 0.004 },
  { day: 'Oct 2', flaky: 0.012, unexpected: 0.006 },
  { day: 'Oct 3', flaky: 0.018, unexpected: 0.003 },
  { day: 'Oct 4', flaky: 0.025, unexpected: 0.005 },
  { day: 'Oct 5', flaky: 0.031, unexpected: 0.004 },
  { day: 'Oct 6', flaky: 0.04, unexpected: 0.007 },
]

const CONFIG = {
  flaky: { label: 'Flaky', color: 'var(--flaky)' },
  unexpected: { label: 'Failed', color: 'var(--fail)' },
} satisfies ChartConfig

export function Rates() {
  return h('div', { class: 'h-48 w-[28rem]' }, [
    h(LineChart<Bucket>, {
      data: DATA,
      x: (_d: Bucket, i: number) => i,
      series: ['flaky', 'unexpected'],
      config: CONFIG,
      xTickFormat: (i: number) => DATA[i]?.day ?? '',
      yFormat: (v: number) => `${Math.round(v * 100)}%`,
      class: 'h-full w-full',
    }),
  ])
}
