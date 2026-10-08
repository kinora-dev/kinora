import { defineComponent, h, ref } from 'vue'
import SegmentedControl from './SegmentedControl.vue'

const OPTIONS = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
]

// The component is controlled, so the story holds the value and records it for the test.
export const Stateful = defineComponent(() => {
  const value = ref('system')
  return () => [
    h(SegmentedControl, { 'modelValue': value.value, 'options': OPTIONS, 'onUpdate:modelValue': (next: string) => (value.value = next) }),
    h('output', { 'data-testid': 'value' }, value.value),
  ]
})

export const IconOnly = () => h(SegmentedControl, { modelValue: 'light', options: OPTIONS, iconOnly: true })
