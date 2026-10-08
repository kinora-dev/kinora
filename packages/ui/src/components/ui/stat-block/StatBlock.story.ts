import { h } from 'vue'
import StatBlock from './StatBlock.vue'

export const Default = () => h(StatBlock, { label: 'Runs', value: 128 })

export const WithSub = () => h(StatBlock, { label: 'Pass rate', value: '98.4%', sub: 'last 20 runs' })

export const FailTone = () => h(StatBlock, { label: 'Failed', value: 3, tone: 'fail' })
