import { defineComponent, h, ref } from 'vue'
import Input from './Input.vue'

export const Default = () => h(Input, { 'placeholder': 'you@team.dev', 'aria-label': 'Email' })

export const Disabled = () => h(Input, { 'defaultValue': 'demo@kinora.dev', 'disabled': true, 'aria-label': 'Email' })

// Two-way binding: the story holds the value and mirrors it for the test.
export const Stateful = defineComponent(() => {
  const value = ref('')
  return () => [
    h(Input, { 'modelValue': value.value, 'aria-label': 'Project name', 'onUpdate:modelValue': (next: string | number) => (value.value = String(next)) }),
    h('output', { 'data-testid': 'value' }, value.value),
  ]
})
