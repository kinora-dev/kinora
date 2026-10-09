import { h } from 'vue'
import Separator from './Separator.vue'

// Decorative by default: a visual rule that assistive tech skips.
export const Decorative = () => h('div', { class: 'w-40' }, [h(Separator)])

// A real boundary between two groups of content.
export const Semantic = () => h('div', { class: 'flex h-10 items-center gap-3' }, ['Runs', h(Separator, { orientation: 'vertical', decorative: false }), 'Tests'])
