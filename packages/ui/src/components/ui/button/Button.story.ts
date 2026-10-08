import { defineComponent, h, ref } from 'vue'
import Button from './Button.vue'

export const Primary = () => h(Button, null, () => 'Save changes')

export const Outline = () => h(Button, { variant: 'outline' }, () => 'Cancel')

export const Destructive = () => h(Button, { variant: 'destructive' }, () => 'Delete project')

export const Disabled = () => h(Button, { disabled: true }, () => 'Save changes')

// Owns the click handler and records its effect in the DOM, for the test to assert on.
export const CountsClicks = defineComponent(() => {
  const clicks = ref(0)
  return () => [
    h(Button, { onClick: () => clicks.value++ }, () => 'Click me'),
    h('output', { 'data-testid': 'clicks' }, String(clicks.value)),
  ]
})
