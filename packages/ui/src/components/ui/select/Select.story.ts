import { defineComponent, h, ref } from 'vue'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '.'

// Holds the selected value and records it for the test.
export const Branch = defineComponent(() => {
  const value = ref<string>()
  return () => [
    h(Select, { 'modelValue': value.value, 'onUpdate:modelValue': (next: unknown) => (value.value = String(next)) }, () => [
      h(SelectTrigger, { 'aria-label': 'Branch' }, () => h(SelectValue, { placeholder: 'Pick a branch' })),
      h(SelectContent, null, () => h(SelectGroup, null, () => [
        h(SelectLabel, null, () => 'Branches'),
        h(SelectItem, { value: 'main' }, () => 'main'),
        h(SelectItem, { value: 'develop' }, () => 'develop'),
        h(SelectItem, { value: 'archived', disabled: true }, () => 'archived'),
      ])),
    ]),
    h('output', { 'data-testid': 'value' }, value.value ?? 'none'),
  ]
})
