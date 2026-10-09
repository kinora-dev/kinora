import { defineComponent, h, ref } from 'vue'
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '.'

const BRANCHES = ['main', 'develop', 'release/2026-10']

// The searchable list behind the dashboard's branch and tag filters. Records the pick.
export const Branches = defineComponent(() => {
  const picked = ref('none')
  return () => [
    h(Command, null, () => [
      h(CommandInput, { placeholder: 'Search branch...' }),
      h(CommandList, null, () => [
        h(CommandEmpty, null, () => 'No branch found.'),
        h(CommandGroup, { heading: 'Branches' }, () => BRANCHES.map(branch =>
          h(CommandItem, { key: branch, value: branch, onSelect: () => (picked.value = branch) }, () => branch),
        )),
      ]),
    ]),
    h('output', { 'data-testid': 'picked' }, picked.value),
  ]
})
