import { defineComponent, h, ref } from 'vue'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '.'
import { Button } from '../button'

// Records the item picked, for the test to assert on.
export const Account = defineComponent(() => {
  const picked = ref('none')
  return () => [
    h(DropdownMenu, null, () => [
      h(DropdownMenuTrigger, { asChild: true }, () => h(Button, { variant: 'outline' }, () => 'Account')),
      h(DropdownMenuContent, null, () => [
        h(DropdownMenuLabel, null, () => 'demo@kinora.dev'),
        h(DropdownMenuSeparator),
        h(DropdownMenuItem, { onSelect: () => (picked.value = 'settings') }, () => 'Settings'),
        h(DropdownMenuItem, { disabled: true }, () => 'Billing'),
        h(DropdownMenuItem, { onSelect: () => (picked.value = 'sign-out') }, () => 'Sign out'),
      ]),
    ]),
    h('output', { 'data-testid': 'picked' }, picked.value),
  ]
})
