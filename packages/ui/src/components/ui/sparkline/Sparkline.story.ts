import { h } from 'vue'
import Sparkline from './Sparkline.vue'

// Pass rates between 0 and 1, oldest first.
export const Default = () => h(Sparkline, { values: [0.92, 0.95, 0.9, 0.97, 0.99, 0.85, 0.96, 1], class: 'text-pass' })

export const Empty = () => h(Sparkline, { values: [] })

// The dip at the sixth run is an environment incident.
export function WithMarkers() {
  return h(Sparkline, {
    values: [0.92, 0.95, 0.9, 0.97, 0.99, 0.05, 0.96, 1],
    markers: [{ index: 5, label: 'Environment incident: staging.example.test' }],
    class: 'text-pass',
  })
}
