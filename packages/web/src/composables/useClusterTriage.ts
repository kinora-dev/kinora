import type { ClusterTriage } from '@kinora/core'
import { ref, shallowRef } from 'vue'
import { toast } from 'vue-sonner'
import { trpc } from '@/lib/trpc'

type TriageInput = Parameters<typeof trpc.dashboard.triageCluster.mutate>[0]
export type TriageChange = Omit<TriageInput, 'projectId' | 'fingerprint'>

function keyOf(projectId: string, fingerprint: string): string {
  return `${projectId}\u0000${fingerprint}`
}

// Saves cluster triage and keeps what was saved, so a list shows it without reloading its query.
export function useClusterTriage() {
  const saved = shallowRef(new Map<string, ClusterTriage>())
  const savingKey = ref<string | null>(null)

  function withTriage<T extends { fingerprint: string, triage?: ClusterTriage }>(projectId: string, c: T): T {
    const t = saved.value.get(keyOf(projectId, c.fingerprint))
    return t ? { ...c, triage: t } : c
  }

  function isSaving(projectId: string, fingerprint: string): boolean {
    return savingKey.value === keyOf(projectId, fingerprint)
  }

  async function save(projectId: string, fingerprint: string, change: TriageChange, message: string): Promise<boolean> {
    const key = keyOf(projectId, fingerprint)
    if (savingKey.value)
      return false
    savingKey.value = key
    try {
      const triage = await trpc.dashboard.triageCluster.mutate({ projectId, fingerprint, ...change })
      saved.value = new Map(saved.value).set(key, triage)
      toast.success(message)
      return true
    }
    catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update the failure')
      return false
    }
    finally {
      savingKey.value = null
    }
  }

  return { withTriage, isSaving, save }
}
