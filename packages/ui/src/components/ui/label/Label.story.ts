import { h } from 'vue'
import { Input } from '../input'
import Label from './Label.vue'

export const WithInput = () => [h(Label, { for: 'project-name' }, () => 'Project name'), h(Input, { id: 'project-name' })]
