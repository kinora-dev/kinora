import { computed, ref } from 'vue'
import { toast } from 'vue-sonner'
import { trpc } from '@/lib/trpc'
import { useQuarantines } from './queries'

// A project's quarantined tests plus the mutations on them, shared by every page that shows or
// edits quarantine so the lookups, toasts and in-flight guard stay the same everywhere.
export function useQuarantine(projectId: string) {
  const { state: quarantines, execute: reload } = useQuarantines(projectId)
  const byKey = computed(() => new Map(quarantines.value.map(q => [q.testKey, q])))
  // Test whose quarantine is being saved; one mutation at a time.
  const savingKey = ref<string | null>(null)

  function isQuarantined(testKey: string): boolean {
    return byKey.value.has(testKey)
  }

  // `action` returns the success message to toast.
  async function mutate(testKey: string, action: () => Promise<string>): Promise<void> {
    if (savingKey.value)
      return
    savingKey.value = testKey
    try {
      toast.success(await action())
      await reload()
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update quarantine')
    }
    finally {
      savingKey.value = null
    }
  }

  // Quarantine a test, or update the reason of one already quarantined.
  function save(testKey: string, reason?: string): Promise<void> {
    return mutate(testKey, async () => {
      const existed = isQuarantined(testKey)
      await trpc.dashboard.quarantine.mutate({ projectId, testKey, reason: reason?.trim() || undefined })
      return existed ? 'Quarantine updated' : 'Test quarantined'
    })
  }

  // `reason` only applies when the toggle quarantines the test.
  function toggle(testKey: string, reason?: string): Promise<void> {
    if (!isQuarantined(testKey))
      return save(testKey, reason)
    return mutate(testKey, async () => {
      await trpc.dashboard.unquarantine.mutate({ projectId, testKey })
      return 'Test removed from quarantine'
    })
  }

  return { quarantines, byKey, isQuarantined, savingKey, save, toggle, reload }
}
