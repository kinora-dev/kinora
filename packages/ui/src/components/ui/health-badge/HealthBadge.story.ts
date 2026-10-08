import { h } from 'vue'
import HealthBadge from './HealthBadge.vue'

export const Passing = () => h(HealthBadge, { health: 'passing' })

export const Flaky = () => h(HealthBadge, { health: 'flaky' })

export const Failing = () => h(HealthBadge, { health: 'failing' })

export const Empty = () => h(HealthBadge, { health: 'empty' })
