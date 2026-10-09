import { h } from 'vue'
import { toast } from 'vue-sonner'
import { Button } from '../button'
import Toaster from './Sonner.vue'
import 'vue-sonner/style.css'

// The app mounts one Toaster and fires toasts from anywhere; the buttons stand in for that code.
export function Default() {
  return [
    h(Toaster, { richColors: true }),
    h(Button, { onClick: () => toast.success('Test quarantined') }, () => 'Notify success'),
    h(Button, { variant: 'destructive', onClick: () => toast.error('Could not update quarantine') }, () => 'Notify error'),
  ]
}
