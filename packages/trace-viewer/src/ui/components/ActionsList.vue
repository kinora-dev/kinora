<script setup lang="ts">
import type { ActionGroup } from '../store'
import { cn } from '@kinora/ui'
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@kinora/ui/dropdown-menu'
import { Ban, Check, ChevronRight, CircleX, Filter, Paperclip, TriangleAlert, X } from '@lucide/vue'
import { computed, nextTick, ref, watch } from 'vue'
import { actionStatus, actionTime, actionTitle, actionTitleParts, isSkippedStep } from '../lib/action'
import { ACTION_GROUPS, useTraceStore } from '../store'
import FilterInput from './FilterInput.vue'
import TextTooltip from './TextTooltip.vue'

const store = useTraceStore()
const filter = store.actionFilter
const shownGroups = store.shownGroups

const groupLabels: Record<ActionGroup, string> = {
  getter: 'Getters',
  route: 'Network routes',
  configuration: 'Configuration',
}

const filtering = computed(() => filter.value.trim().length > 0)

function setGroup(group: ActionGroup, checked: boolean): void {
  const rest = shownGroups.value.filter(g => g !== group)
  shownGroups.value = checked ? [...rest, group] : rest
}

const groupRows = computed(() => ACTION_GROUPS.map(group => ({
  group,
  label: groupLabels[group],
  count: store.model.value?.actionCounters.get(group) ?? 0,
  checked: shownGroups.value.includes(group),
})))

const rows = computed(() => {
  const model = store.model.value
  return store.listedRows.value.map(({ item, context }) => {
    const { parts, subtitle } = actionTitleParts(item.action, model?.sdkLanguage)
    const stats = model?.stats(item.action) ?? { errors: 0, warnings: 0 }
    return {
      item,
      context,
      parts,
      subtitle,
      title: actionTitle(item.action),
      status: actionStatus(item.action),
      skipped: isSkippedStep(item.action),
      time: actionTime(item.action),
      errors: stats.errors,
      warnings: stats.warnings,
      attachments: item.action.attachments?.filter(a => !a.name.startsWith('_')).length ?? 0,
    }
  })
})

// A selection made elsewhere (timeline, playback, keyboard) opens the steps hiding it and scrolls to it.
const list = ref<HTMLElement | null>(null)
watch(() => store.selectedId.value, async (id) => {
  const index = store.items.value.findIndex(item => item.id === id)
  if (index === -1)
    return
  let depth = store.items.value[index].depth
  const opened = new Set(store.collapsed.value)
  for (let i = index - 1; i >= 0 && depth > 0; i--) {
    const item = store.items.value[i]
    if (item.depth < depth) {
      opened.delete(item.id)
      depth = item.depth
    }
  }
  if (opened.size !== store.collapsed.value.size)
    store.collapsed.value = opened
  await nextTick()
  list.value?.querySelector('[data-selected]')?.scrollIntoView({ block: 'nearest' })
})

function pluralize(count: number, noun: string): string {
  return count ? `${count} ${noun}${count === 1 ? '' : 's'}` : ''
}

const countLabel = computed(() => {
  const total = store.items.value.length
  const shown = rows.value.filter(r => !r.context).length
  return shown === total && !filtering.value && !store.timeRange.value
    ? String(total)
    : `${shown} / ${total}`
})
</script>

<template>
  <div class="flex h-full flex-col">
    <div class="flex h-11 shrink-0 items-center border-b border-border px-3">
      <div class="flex items-baseline gap-2">
        <span class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Actions</span>
        <span class="font-mono text-[11px] text-muted-foreground/70">{{ countLabel }}</span>
        <span v-if="store.hiddenActionCount.value" class="font-mono text-[11px] text-muted-foreground/70">{{ store.hiddenActionCount.value }} hidden</span>
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

    <div ref="list" data-action-list role="tree" aria-label="Actions" class="min-h-0 flex-1 overflow-y-auto py-1">
      <div
        v-for="row in rows"
        :key="row.item.id"
        role="treeitem"
        tabindex="0"
        :aria-level="row.item.depth + 1"
        :aria-expanded="row.item.hasChildren && !filtering && !store.timeRange.value ? !store.collapsed.value.has(row.item.id) : undefined"
        :aria-selected="store.selectedId.value === row.item.id"
        data-testid="action"
        :data-context="row.context || undefined"
        :data-selected="store.selectedId.value === row.item.id || undefined"
        :class="cn(
          'group relative flex w-full cursor-pointer items-center gap-2 py-1.5 pr-2.5 text-left text-[13px] transition-colors',
          store.selectedId.value === row.item.id
            ? 'bg-signal/10 text-foreground'
            : store.hoveredActionId.value === row.item.id
              ? 'bg-muted/60 text-foreground'
              : 'text-foreground/80 hover:bg-muted/50',
          row.context && 'opacity-60',
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
          <span
            v-if="!filtering && !store.timeRange.value && row.item.hasChildren"
            data-testid="action-expander"
            class="flex cursor-pointer items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            :title="store.collapsed.value.has(row.item.id) ? 'Expand (Alt+click: all steps inside)' : 'Collapse (Alt+click: all steps inside)'"
            @click.stop="store.toggleCollapse(row.item.id, $event.altKey)"
          >
            <ChevronRight :class="cn('size-3.5 transition-transform', !store.collapsed.value.has(row.item.id) && 'rotate-90', row.status === 'error' && 'text-fail')" />
          </span>
          <X v-else-if="row.status === 'error'" class="size-3.5 text-fail" />
          <Ban v-else-if="row.skipped" data-testid="action-skipped" class="size-3.5 text-muted-foreground" aria-label="skipped" />
          <Check v-else-if="row.status === 'ok'" class="size-3.5 text-pass" />
        </span>
        <span class="flex min-w-0 flex-1 flex-col">
          <TextTooltip :text="row.title" class="min-w-0">
            <span v-for="(part, i) in row.parts" :key="i" :data-testid="part.param ? 'action-param' : undefined" :class="part.param && 'text-info'">{{ part.text }}</span>
          </TextTooltip>
          <span v-if="row.subtitle" data-testid="action-subtitle" class="truncate text-[11px] text-muted-foreground" :title="row.subtitle">{{ row.subtitle }}</span>
        </span>
        <button
          v-if="row.attachments"
          type="button"
          data-testid="action-attachment"
          :title="`Open ${pluralize(row.attachments, 'attachment')}`"
          class="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          @click.stop="store.revealAttachment(row.item.id)"
        >
          <Paperclip class="size-3" />
        </button>
        <button
          v-if="row.errors || row.warnings"
          type="button"
          data-testid="action-console-badge"
          :aria-label="`Reveal console, ${[pluralize(row.errors, 'error'), pluralize(row.warnings, 'warning')].filter(Boolean).join(', ')}`"
          title="Reveal console"
          class="flex shrink-0 items-center gap-1.5 rounded px-1 font-mono text-[11px] tabular-nums transition-colors hover:bg-muted"
          @click.stop="store.revealConsole(row.item.id)"
        >
          <span v-if="row.errors" class="flex items-center gap-0.5 text-fail"><CircleX class="size-3" />{{ row.errors }}</span>
          <span v-if="row.warnings" class="flex items-center gap-0.5 text-flaky"><TriangleAlert class="size-3" />{{ row.warnings }}</span>
        </button>
        <span v-if="!row.skipped" data-testid="action-time" class="shrink-0 font-mono text-[11px] tabular-nums text-muted-foreground/70">{{ row.time }}</span>
      </div>
    </div>
  </div>
</template>
