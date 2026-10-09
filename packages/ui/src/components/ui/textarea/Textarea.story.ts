import { defineComponent, h, ref } from 'vue'
import Textarea from './Textarea.vue'

export const Stateful = defineComponent(() => {
  const value = ref('')
  return () => [
    h(Textarea, { 'modelValue': value.value, 'placeholder': 'Add a reason for the team...', 'maxlength': 20, 'onUpdate:modelValue': (next: string | number) => (value.value = String(next)) }),
    h('output', { 'data-testid': 'value' }, value.value),
  ]
})
