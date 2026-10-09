import { defineComponent, h, ref } from 'vue'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '.'
import { Button } from '../button'

// Records which button answered the confirmation, for the test to assert on.
export const Confirm = defineComponent(() => {
  const outcome = ref('pending')
  return () => [
    h(AlertDialog, null, () => [
      h(AlertDialogTrigger, { asChild: true }, () => h(Button, { variant: 'destructive' }, () => 'Delete project')),
      h(AlertDialogContent, null, () => [
        h(AlertDialogHeader, null, () => [
          h(AlertDialogTitle, null, () => 'Delete Web App?'),
          h(AlertDialogDescription, null, () => 'This removes every run and artifact. It cannot be undone.'),
        ]),
        h(AlertDialogFooter, null, () => [
          h(AlertDialogCancel, { onClick: () => (outcome.value = 'cancelled') }, () => 'Cancel'),
          h(AlertDialogAction, { onClick: () => (outcome.value = 'confirmed') }, () => 'Delete'),
        ]),
      ]),
    ]),
    h('output', { 'data-testid': 'outcome' }, outcome.value),
  ]
})
