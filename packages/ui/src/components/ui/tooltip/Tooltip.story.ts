import { h } from 'vue'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '.'
import { Button } from '../button'

// No open delay, so the test does not wait on a timer.
export function Default() {
  return h(TooltipProvider, { delayDuration: 0 }, () => h(Tooltip, null, () => [
    h(TooltipTrigger, { asChild: true }, () => h(Button, { variant: 'outline' }, () => 'Copy link')),
    h(TooltipContent, null, () => 'Copies the page URL'),
  ]))
}
