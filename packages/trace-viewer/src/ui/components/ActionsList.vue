<script setup lang="ts">
import type { ActionEntry } from '@isomorphic/trace/entries'
import { cn } from '@kinora/ui'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@kinora/ui/dropdown-menu'
import { Check, ChevronRight, Filter, X } from '@lucide/vue'
import { computed, ref } from 'vue'
import { actionDuration, actionStatus, actionTitle } from '../lib/action'
import { formatMs } from '../lib/format'
import { actionInWindow } from '../lib/timeline'
import { useTraceStore } from '../store'
import FilterInput from './FilterInput.vue'
import TextTooltip from './TextTooltip.vue'

const store = useTraceStore()
const filter = ref('')

const ACTION_GROUPS = ['getter', 'route', 'configuration'] as const
type ActionGroup = typeof ACTION_GROUPS[number]

const groupLabels: Record<ActionGroup, string> = {
  getter: 'Getters',
  route: 'Network routes',
  configuration: 'Configuration',
}

const visibleGroups = ref<Set<ActionGroup>>(new Set(ACTION_GROUPS))

const filtering = computed(() => filter.value.trim().length > 0)

function groupFor(action: ActionEntry): ActionGroup | undefined {
  return ACTION_GROUPS.find(group => group === action.group)
}

function actionPassesGroup(action: ActionEntry): boolean {
  const group = groupFor(action)
  return !group || visibleGroups.value.has(group)
}

function setGroup(group: ActionGroup, checked: boolean): void {
  const next = new Set(visibleGroups.value)
  if (checked)
    next.add(group)
  else
    next.delete(group)
  visibleGroups.value = next
}

const hiddenByGroupCount = computed(() => store.items.value.filter(item => !actionPassesGroup(item.action)).length)

const groupRows = computed(() => ACTION_GROUPS.map(group => ({
  group,
  label: groupLabels[group],
  count: store.model.value?.actionCounters.get(group) ?? 0,
  checked: visibleGroups.value.has(group),
})))

const rows = computed(() => {
  const f = filter.value.trim().toLowerCase()
  const range = store.timeRange.value
  // While filtering or zoomed, search the full flat list; otherwise follow collapse state.
  const source = f || range ? store.items.value : store.visibleItems.value
  return source
    .filter(item => actionPassesGroup(item.action))
    .filter(item => !range || actionInWindow(item.action, range))
    .map(item => ({
      item,
      title: actionTitle(item.action),
      status: actionStatus(item.action),
      duration: actionDuration(item.action),
    }))
    .filter(r => !f || r.title.toLowerCase().includes(f))
})

const countLabel = computed(() => {
  const total = store.items.value.length
  return rows.value.length === total && !filtering.value && !store.timeRange.value
    ? String(total)
    : `${rows.value.length} / ${total}`
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex h-11 shrink-0 items-center border-b border-border px-3">
      <div class="flex items-baseline gap-2">
        <span class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Actions</span>
        <span class="font-mono text-[11px] text-muted-foreground/70">{{ countLabel }}</span>
        <span v-if="hiddenByGroupCount" class="font-mono text-[11px] text-muted-foreground/70">{{ hiddenByGroupCount }} hidden</span>
      </div>
    </div>

    <div class="flex h-12 shrink-0 items-stretch border-b border-border">
      <FilterInput v-model="filter" placeholder="Filter actions" class="min-w-0 flex-1 rounded-none bg-transparent px-3 py-0" />
      <DropdownMenu>
        <DropdownMenuTrigger
          class="flex w-11 shrink-0 items-center justify-center border-l border-border text-muted-foreground transition-colors hover:bg-muted/50 hover:text-foreground data-[state=open]:bg-muted/50 data-[state=open]:text-foreground"
          aria-label="Filter actions"
          title="Filter actions"
        >
          <Filter class="size-4" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" class="w-52">
          <DropdownMenuLabel>Show action groups</DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            v-for="row in groupRows"
            :key="row.group"
            :model-value="row.checked"
            :disabled="row.count === 0"
            @update:model-value="setGroup(row.group, $event)"
          >
            <span class="min-w-0 flex-1">{{ row.label }}</span>
            <span class="ml-auto font-mono text-[11px] text-muted-foreground">{{ row.count }}</span>
          </DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto py-1">
      <button
        v-for="row in rows"
        :key="row.item.id"
        type="button"
        data-testid="action"
        :class="cn(
          'group relative flex w-full items-center gap-2 py-1.5 pr-2.5 text-left text-[13px] transition-colors',
          store.selectedId.value === row.item.id
            ? 'bg-signal/10 text-foreground'
            : store.hoveredActionId.value === row.item.id
              ? 'bg-muted/60 text-foreground'
              : 'text-foreground/80 hover:bg-muted/50',
        )"
        :style="{ paddingLeft: `${10 + row.item.depth * 14}px` }"
        @click="store.select(row.item.id)"
        @dblclick="store.zoomToAction(row.item.action)"
        @mouseenter="store.setHoveredAction(row.item.id)"
        @mouseleave="store.setHoveredAction(null)"
      >
        <span
          v-if="store.selectedId.value === row.item.id"
          class="absolute inset-y-0 left-0 w-0.5 bg-signal"
        />
        <span class="flex size-4 shrink-0 items-center justify-center">
          <X v-if="row.status === 'error'" class="size-3.5 text-fail" />
          <span
            v-else-if="!filtering && row.item.hasChildren"
            class="flex cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            @click.stop="store.toggleCollapse(row.item.id)"
          >
            <ChevronRight :class="cn('size-3.5 transition-transform', !store.collapsed.value.has(row.item.id) && 'rotate-90')" />
          </span>
          <Check v-else-if="row.status === 'ok'" class="size-3.5 text-pass" />
        </span>
        <TextTooltip :text="row.title" class="min-w-0 flex-1" />
        <span class="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">{{ formatMs(row.duration) }}</span>
      </button>
    </div>
  </div>
</template>
