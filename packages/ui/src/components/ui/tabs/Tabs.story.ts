import { h } from 'vue'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '.'

export function Default() {
  return h(Tabs, { defaultValue: 'all' }, () => [
    h(TabsList, null, () => [
      h(TabsTrigger, { value: 'all' }, () => 'All'),
      h(TabsTrigger, { value: 'failed' }, () => 'Failed'),
      h(TabsTrigger, { value: 'skipped', disabled: true }, () => 'Skipped'),
    ]),
    h(TabsContent, { value: 'all' }, () => 'Every test of the run'),
    h(TabsContent, { value: 'failed' }, () => 'Only the failed tests'),
  ])
}
