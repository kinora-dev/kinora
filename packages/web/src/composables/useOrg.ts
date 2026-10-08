import { computed, onMounted, ref } from 'vue'
import { toast } from 'vue-sonner'
import { authClient } from '@/lib/auth'
import { session } from '@/lib/session'

type FullOrg = typeof authClient.$Infer.ActiveOrganization
type OrgList = (typeof authClient.$Infer.Organization)[]
type Role = (typeof authClient.$Infer.Member)['role']

// Shared across the header switcher, settings, and the team card so org state loads once.
const org = ref<FullOrg | null>(null)
const orgs = ref<OrgList>([])
const loading = ref(false)
const inviting = ref(false)
const renaming = ref(false)
let loaded = false

async function load(): Promise<void> {
  loading.value = true
  try {
    const [full, list] = await Promise.all([
      authClient.organization.getFullOrganization(),
      authClient.organization.list(),
    ])
    org.value = full.data
    orgs.value = list.data ?? []

    // Session has orgs but none active (e.g. fresh sign-up, where the membership lands
    // after the session is created): activate one and persist it on the session.
    const first = orgs.value[0]
    if (!org.value && first) {
      await authClient.organization.setActive({ organizationId: first.id })
      org.value = (await authClient.organization.getFullOrganization()).data
    }

    loaded = true
  }
  catch {
    // Unreachable server, or the request was cut short by navigating away. Keep what we have:
    // `loaded` stays false so the next mount retries, and the page shows its own error state.
  }
  finally {
    // Always released, or one failed load would block every later one.
    loading.value = false
  }
}

// Clear the shared cache on sign-out so the next login reloads fresh (avoids a stale switcher).
export function resetOrgState(): void {
  org.value = null
  orgs.value = []
  loaded = false
}

export function useOrg(options?: { autoLoad?: boolean }) {
  const members = computed(() => org.value?.members ?? [])
  const invitations = computed(() => (org.value?.invitations ?? []).filter(i => i.status === 'pending'))

  const myRole = computed<Role | null>(() => {
    const uid = session.user.value?.id
    return members.value.find(m => m.userId === uid)?.role ?? null
  })
  const isAdmin = computed(() => myRole.value === 'owner' || myRole.value === 'admin')
  // Billing maps the Polar customer to the org owner, so only the owner can change the plan.
  const isOwner = computed(() => myRole.value === 'owner')

  async function rename(name: string): Promise<void> {
    const id = org.value?.id
    if (!id)
      return
    renaming.value = true
    const { error } = await authClient.organization.update({ organizationId: id, data: { name: name.trim() } })
    renaming.value = false
    if (error) {
      toast.error(error.message ?? 'Could not rename workspace')
      return
    }
    await load()
    toast.success('Workspace renamed')
  }

  async function invite(email: string, role: 'admin' | 'member' = 'member'): Promise<string | null> {
    inviting.value = true
    const { data, error } = await authClient.organization.inviteMember({ email: email.trim(), role })
    inviting.value = false
    if (error || !data) {
      toast.error(error?.message ?? 'Could not send invitation')
      return null
    }
    await load()
    return data.id
  }

  async function removeMember(memberId: string): Promise<void> {
    const { error } = await authClient.organization.removeMember({ memberIdOrEmail: memberId })
    if (error) {
      toast.error(error.message ?? 'Could not remove member')
      return
    }
    toast.success('Member removed')
    await load()
  }

  async function updateRole(memberId: string, role: 'admin' | 'member'): Promise<void> {
    const { error } = await authClient.organization.updateMemberRole({ memberId, role })
    if (error) {
      toast.error(error.message ?? 'Could not update role')
      return
    }
    await load()
  }

  async function cancelInvitation(invitationId: string): Promise<void> {
    const { error } = await authClient.organization.cancelInvitation({ invitationId })
    if (error) {
      toast.error(error.message ?? 'Could not cancel invitation')
      return
    }
    await load()
  }

  async function setActive(organizationId: string): Promise<void> {
    await authClient.organization.setActive({ organizationId })
    // Land on the overview: the current project/run URL may not exist in the new org.
    // Full navigation so every org-scoped query refetches fresh.
    window.location.assign('/')
  }

  if ((options?.autoLoad ?? true) && !loaded && !loading.value)
    onMounted(load)

  return { org, orgs, members, invitations, loading, inviting, renaming, myRole, isAdmin, isOwner, rename, invite, removeMember, updateRole, cancelInvitation, setActive, load }
}
