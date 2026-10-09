import { h } from 'vue'
import { Card, CardAction, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '.'
import { Button } from '../button'

export function Default() {
  return h(Card, { class: 'w-80' }, () => [
    h(CardHeader, null, () => [
      h(CardTitle, null, () => 'Web App'),
      h(CardDescription, null, () => 'Last run 2 hours ago'),
      h(CardAction, null, () => h(Button, { variant: 'ghost', size: 'sm' }, () => 'Open')),
    ]),
    h(CardContent, null, () => '98.4% pass rate over the last 20 runs'),
    h(CardFooter, null, () => 'main · 1de4783'),
  ])
}
