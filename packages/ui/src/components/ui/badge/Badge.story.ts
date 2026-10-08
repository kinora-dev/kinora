import { h } from 'vue'
import Badge from './Badge.vue'

export const Default = () => h(Badge, null, () => 'New')

export const Outline = () => h(Badge, { variant: 'outline' }, () => 'Beta')

// `as` swaps the rendered element, so a badge can be a link.
export const AsLink = () => h(Badge, { as: 'a', href: '#docs' }, () => 'Docs')
