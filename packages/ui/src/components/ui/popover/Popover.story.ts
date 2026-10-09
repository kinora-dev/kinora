import { h } from 'vue'
import { Popover, PopoverContent, PopoverTrigger } from '.'
import { Button } from '../button'

export function Default() {
  return h(Popover, null, () => [
    h(PopoverTrigger, { asChild: true }, () => h(Button, { variant: 'outline' }, () => 'Filters')),
    h(PopoverContent, null, () => 'Only show runs from the main branch.'),
  ])
}
