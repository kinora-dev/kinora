import type { ChartConfig } from '../chart'
import { h } from 'vue'
import AreaChart from './AreaChart.vue'

// A type alias, not an interface: the chart wants a Record<string, unknown>.
// eslint-disable-next-line ts/consistent-type-definitions
type Bucket = { day: string, count: number }

const DATA: Bucket[] = [
  { day: 'Oct 1', count: 4 },
  { day: 'Oct 2', count: 9 },
  { day: 'Oct 3', count: 6 },
  { day: 'Oct 4', count: 14 },
  { day: 'Oct 5', count: 11 },
  { day: 'Oct 6', count: 18 },
]

const CONFIG = { count: { label: 'Runs', color: 'var(--chart-2)' } } satisfies ChartConfig

export function Default() {
  return h('div', { class: 'h-40 w-96' }, [
    h(AreaChart<Bucket>, {
      data: DATA,
      x: (_d: Bucket, i: number) => i,
      y: (d: Bucket) => d.count,
      config: CONFIG,
      seriesKey: 'count',
      xTickFormat: (i: number) => DATA[i]?.day ?? '',
      class: 'h-full w-full',
    }),
  ])
}
