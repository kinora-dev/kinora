<script setup lang="ts">
import type { FailureCluster } from '@kinora/core'
import type { TriageChange } from '@/composables/useClusterTriage'
import { clusterState, isSnoozed } from '@kinora/core'
import { Button } from '@kinora/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@kinora/ui/dropdown-menu'
import { Input } from '@kinora/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@kinora/ui/popover'
import { Textarea } from '@kinora/ui/textarea'
import { AlarmClock, Check, ChevronDown, EyeOff, Link2, RotateCcw, UserRound } from '@lucide/vue'
import { computed, ref, watch } from 'vue'
import { useOrg } from '@/composables/useOrg'
import { SNOOZE_OPTIONS } from '@/lib/cluster-triage'
import { session } from '@/lib/session'

const props = defineProps<{
  cluster: Pick<FailureCluster, 'fingerprint' | 'lastSeen' | 'lastSeenMainline' | 'quietRuns' | 'triage'>
  saving?: boolean
  disabled?: boolean
  // The inbox row: no issue and note editor, which needs the room of the cluster's own page.
  compact?: boolean
}>()

const emit = defineEmits<{ save: [change: TriageChange, message: string] }>()

const { members } = useOrg()
const me = computed(() => session.user.value?.id)

const state = computed(() => clusterState(props.cluster))
const snoozed = computed(() => isSnoozed(props.cluster))
const assigneeId = computed(() => props.cluster.triage?.assignee?.id)
const canSnooze = computed(() => (props.cluster.triage?.status ?? 'open') === 'open')
const busy = computed(() => props.saving || props.disabled)

function assign(userId: string | null, name?: string): void {
  emit('save', { assigneeId: userId }, userId ? `Assigned to ${userId === me.value ? 'you' : name}` : 'Unassigned')
}

function snooze(until: string): void {
  emit('save', { snooze: until === 'recur' ? 'recur' : { until } }, 'Failure snoozed')
}

const issueOpen = ref(false)
const issueUrl = ref('')
const note = ref('')
watch(issueOpen, (open) => {
  if (open) {
    issueUrl.value = props.cluster.triage?.issueUrl ?? ''
    note.value = props.cluster.triage?.note ?? ''
  }
})
const validUrl = computed(() => !issueUrl.value.trim() || /^https?:\/\/\S+$/i.test(issueUrl.value.trim()))

function saveIssue(): void {
  emit('save', { issueUrl: issueUrl.value.trim() || null, note: note.value.trim() || null }, 'Failure updated')
  issueOpen.value = false
}
</script>

<template>
  <div class="flex flex-wrap items-center gap-1.5">
    <template v-if="state === 'resolved' || state === 'ignored'">
      <Button variant="outline" size="sm" class="h-7 font-mono text-[11px]" :disabled="busy" @click="emit('save', { status: 'open' }, 'Failure reopened')">
        <RotateCcw class="size-3" /> Reopen
      </Button>
    </template>
    <template v-else>
      <Button variant="outline" size="sm" class="h-7 font-mono text-[11px]" :disabled="busy" @click="emit('save', { status: 'resolved' }, 'Failure resolved')">
        <Check class="size-3" /> {{ state === 'regressed' ? 'Resolve again' : 'Resolve' }}
      </Button>
      <Button
        v-if="state === 'regressed'"
        variant="ghost"
        size="sm"
        class="h-7 font-mono text-[11px] text-muted-foreground"
        :disabled="busy"
        @click="emit('save', { status: 'open' }, 'Failure reopened')"
      >
        <RotateCcw class="size-3" /> Reopen
      </Button>
    </template>

    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="sm" class="h-7 font-mono text-[11px] text-muted-foreground" :disabled="busy">
          <UserRound class="size-3" />
          {{ cluster.triage?.assignee ? cluster.triage.assignee.name : 'Assign' }}
          <ChevronDown class="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-56">
        <DropdownMenuItem v-if="me && assigneeId !== me" @click="assign(me)">
          Assign to me
        </DropdownMenuItem>
        <DropdownMenuSeparator v-if="me && assigneeId !== me" />
        <DropdownMenuLabel class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
          Members
        </DropdownMenuLabel>
        <DropdownMenuItem
          v-for="m in members"
          :key="m.userId"
          class="justify-between gap-2"
          @click="assign(m.userId, m.user?.name || m.user?.email)"
        >
          <span class="truncate">{{ m.user?.name || m.user?.email }}</span>
          <Check v-if="m.userId === assigneeId" class="size-3.5 text-signal" />
        </DropdownMenuItem>
        <template v-if="assigneeId">
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="assign(null)">
            Unassign
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <DropdownMenu v-if="canSnooze">
      <DropdownMenuTrigger as-child>
        <Button variant="ghost" size="sm" class="h-7 font-mono text-[11px] text-muted-foreground" :disabled="busy">
          <AlarmClock class="size-3" /> {{ snoozed ? 'Snoozed' : 'Snooze' }}
          <ChevronDown class="size-3" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" class="w-52">
        <DropdownMenuItem v-for="o in SNOOZE_OPTIONS" :key="o.label" @click="snooze(o.until())">
          {{ o.label }}
        </DropdownMenuItem>
        <template v-if="snoozed">
          <DropdownMenuSeparator />
          <DropdownMenuItem @click="emit('save', { snooze: null }, 'Snooze lifted')">
            Unsnooze
          </DropdownMenuItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>

    <Button
      v-if="!compact && state !== 'ignored' && state !== 'resolved'"
      variant="ghost"
      size="sm"
      class="h-7 font-mono text-[11px] text-muted-foreground"
      :disabled="busy"
      @click="emit('save', { status: 'ignored' }, 'Failure ignored')"
    >
      <EyeOff class="size-3" /> Ignore
    </Button>

    <Popover v-if="!compact" v-model:open="issueOpen">
      <PopoverTrigger as-child>
        <Button variant="ghost" size="sm" class="h-7 font-mono text-[11px] text-muted-foreground" :disabled="busy">
          <Link2 class="size-3" /> {{ cluster.triage?.issueUrl || cluster.triage?.note ? 'Edit issue & note' : 'Link issue' }}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" class="flex w-80 flex-col gap-3">
        <label class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Known issue</span>
          <Input v-model="issueUrl" placeholder="https://github.com/org/repo/issues/123" :aria-invalid="!validUrl" class="h-8 text-xs" />
        </label>
        <label class="flex flex-col gap-1.5">
          <span class="font-mono text-[10px] tracking-wider text-muted-foreground uppercase">Note</span>
          <Textarea v-model="note" placeholder="What the team knows so far..." :maxlength="2000" class="min-h-20 text-xs" />
        </label>
        <Button size="sm" class="self-end font-mono text-xs" :disabled="!validUrl || busy" @click="saveIssue">
          Save
        </Button>
      </PopoverContent>
    </Popover>
  </div>
</template>
