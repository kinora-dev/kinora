import { useForm } from 'vee-validate'
import { defineComponent, h, ref } from 'vue'
import { FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from '.'
import { Button } from '../button'
import { Input } from '../input'

// A one-field form validated on submit. It records the value it accepted, for the test.
export const Email = defineComponent(() => {
  const submitted = ref('none')
  const { handleSubmit } = useForm({
    validationSchema: { email: (value: unknown) => (typeof value === 'string' && /^\S[^\s@]*@\S[^\s.]*\.\S+$/.test(value)) || 'Enter a valid email' },
  })
  const onSubmit = handleSubmit((values) => {
    submitted.value = String(values.email)
  })

  return () => [
    h('form', { novalidate: true, onSubmit }, [
      h(FormField, { name: 'email' }, {
        default: ({ componentField }: { componentField: Record<string, unknown> }) => h(FormItem, null, () => [
          h(FormLabel, null, () => 'Email'),
          h(FormControl, null, () => h(Input, { type: 'email', placeholder: 'you@team.dev', ...componentField })),
          h(FormDescription, null, () => 'We only use it to sign you in.'),
          h(FormMessage),
        ]),
      }),
      h(Button, { type: 'submit' }, () => 'Send reset link'),
    ]),
    h('output', { 'data-testid': 'submitted' }, submitted.value),
  ]
})
