import { useAsyncState } from '@vueuse/core'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { track } from '@/lib/analytics'
import { authClient } from '@/lib/auth'
import { reportQueryError } from '@/lib/errors'
import { trpc } from '@/lib/trpc'

export function useBilling() {
  const { state: summary, isLoading, execute: refresh } = useAsyncState(
    () => trpc.billing.summary.query(),
    null,
    { immediate: true, resetOnExecute: false, onError: reportQueryError },
  )

  // Which billing action is mid-flight, so the buttons can disable + show progress.
  const pending = ref<'team' | 'pro' | 'portal' | null>(null)
  const usageEmailPending = ref(false)

  async function checkout(slug: 'team' | 'pro'): Promise<void> {
    pending.value = slug
    track('upgrade-click', { plan: slug })
    try {
      const { error } = await authClient.checkout({ slug })
      if (error)
        toast.error(error.message ?? 'Could not start checkout')
    }
    finally {
      pending.value = null
    }
  }

  async function openPortal(): Promise<void> {
    pending.value = 'portal'
    try {
      const { error } = await authClient.customer.portal()
      if (error)
        toast.error(error.message ?? 'Could not open the billing portal')
    }
    finally {
      pending.value = null
    }
  }

  async function updateUsageEmailSettings(input: { usageNearEmailEnabled: boolean, usageLimitEmailEnabled: boolean }): Promise<void> {
    usageEmailPending.value = true
    try {
      const next = await trpc.billing.updateUsageEmailSettings.mutate(input)
      if (summary.value)
        summary.value = { ...summary.value, ...next }
      toast.success('Usage email settings saved')
    }
    catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save usage email settings')
    }
    finally {
      usageEmailPending.value = false
    }
  }

  return { summary, isLoading, refresh, pending, usageEmailPending, checkout, openPortal, updateUsageEmailSettings }
}
