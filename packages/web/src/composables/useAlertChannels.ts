import { useAsyncState } from '@vueuse/core'
import { ref } from 'vue'
import { toast } from 'vue-sonner'
import { reportQueryError } from '@/lib/errors'
import { trpc } from '@/lib/trpc'

type Policy = 'always' | 'on-failure' | 'on-regression'
type Kind = 'email' | 'webhook'

export function useAlertChannels(projectId: string) {
  const { state: channels, isLoading, execute: refresh } = useAsyncState(
    () => trpc.alerts.channels.query({ projectId }),
    [],
    { immediate: true, resetOnExecute: false, onError: reportQueryError },
  )

  const adding = ref(false)
  const testingId = ref<string | null>(null)

  async function add(input: { kind: Kind, target: string, policy: Policy }): Promise<boolean> {
    adding.value = true
    try {
      await trpc.alerts.addChannel.mutate({ projectId, ...input })
      await refresh()
      toast.success('Channel added')
      return true
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not add channel')
      return false
    }
    finally {
      adding.value = false
    }
  }

  async function update(id: string, input: { policy: Policy, enabled: boolean }): Promise<void> {
    try {
      await trpc.alerts.updateChannel.mutate({ id, ...input })
      await refresh()
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update channel')
    }
  }

  async function remove(id: string): Promise<void> {
    try {
      await trpc.alerts.removeChannel.mutate({ id })
      await refresh()
      toast.success('Channel removed')
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not remove channel')
    }
  }

  async function test(id: string): Promise<void> {
    testingId.value = id
    try {
      await trpc.alerts.testChannel.mutate({ id })
      toast.success('Test alert sent')
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test failed')
    }
    finally {
      testingId.value = null
    }
  }

  return { channels, isLoading, adding, testingId, refresh, add, update, remove, test }
}
