import { h } from 'vue'
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '.'
import { Button } from '../button'

export function Default() {
  return h(Dialog, null, () => [
    h(DialogTrigger, { asChild: true }, () => h(Button, { variant: 'outline' }, () => 'Send feedback')),
    h(DialogContent, null, () => [
      h(DialogHeader, null, () => [
        h(DialogTitle, null, () => 'Send feedback'),
        h(DialogDescription, null, () => 'Tell us what is missing or broken.'),
      ]),
      h(DialogFooter, null, () => h(DialogClose, { asChild: true }, () => h(Button, null, () => 'Done'))),
    ]),
  ])
}
