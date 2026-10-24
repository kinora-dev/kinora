<script setup lang="ts">
import { cn } from '@kinora/ui'
import { Check, Copy } from '@lucide/vue'
import { computed, ref } from 'vue'
import { callSummary } from '../lib/call'
import { copyText } from '../lib/clipboard'
import { useTraceStore } from '../store'
import AnsiText from './AnsiText.vue'

const store = useTraceStore()

const summary = computed(() => {
  const action = store.activeAction.value
  const model = store.model.value
  return action ? callSummary(action, { sdkLanguage: model?.sdkLanguage, startTime: model?.startTime }) : null
})

// Key details and the return value only show when they have rows; params always show.
const sections = computed(() => summary.value
  ? [
      { id: 'primary', label: 'Key details', rows: summary.value.primary },
      { id: 'params', label: 'All params', rows: summary.value.params },
      { id: 'result', label: 'Return value', rows: summary.value.result },
    ].filter(section => section.id === 'params' || section.rows.length)
  : [])

const copiedKey = ref<string>()

async function copyValue(id: string, value: string): Promise<void> {
  if (!await copyText(value))
    return
  copiedKey.value = id
  setTimeout(() => {
    if (copiedKey.value === id)
      copiedKey.value = undefined
  }, 1500)
}

const allParamsText = computed(() => JSON.stringify(store.activeAction.value?.params ?? {}, null, 2))

function copyParams(): void {
  void copyText(allParamsText.value)
}

const statusClass = computed(() => {
  if (summary.value?.statusTone === 'error')
    return 'border-fail/30 bg-fail/10 text-fail'
  if (summary.value?.statusTone === 'muted')
    return 'border-border bg-muted text-muted-foreground'
  return 'border-pass/30 bg-pass/10 text-pass'
})
</script>

<template>
  <div class="h-full overflow-auto p-3">
    <div v-if="!summary" class="flex h-full items-center justify-center text-sm text-muted-foreground">
      No call selected
    </div>

    <div v-else class="space-y-4 text-xs">
      <div class="rounded-lg border border-border bg-muted/20 p-3">
        <div class="mb-2 flex items-start gap-2">
          <div class="min-w-0 flex-1">
            <div data-testid="call-title" class="truncate text-sm font-semibold text-foreground">
              {{ summary.title }}
            </div>
            <div data-testid="call-method" class="mt-0.5 font-mono text-[11px] text-muted-foreground">
              {{ summary.subtitle }}
            </div>
          </div>
          <span :class="cn('rounded border px-1.5 py-0.5 font-mono text-[10px]', statusClass)">
            {{ summary.status }}
          </span>
        </div>
        <div class="grid grid-cols-3 gap-2 text-muted-foreground">
          <div>
            <span class="uppercase tracking-wide">Start</span>
            <div data-testid="call-start" class="font-mono text-foreground/90">
              {{ summary.start }}
            </div>
          </div>
          <div>
            <span class="uppercase tracking-wide">Duration</span>
            <div data-testid="call-duration" class="font-mono text-foreground/90">
              {{ summary.duration }}
            </div>
          </div>
          <div>
            <span class="uppercase tracking-wide">Call id</span>
            <div class="font-mono text-foreground/90">
              {{ store.activeAction.value?.callId }}
            </div>
          </div>
        </div>
      </div>

      <section v-if="summary.error" class="rounded-md border border-fail/30 bg-fail/5 p-3 text-fail">
        <div class="mb-1 font-semibold tracking-wide uppercase">
          Error
        </div>
        <div class="whitespace-pre-wrap">
          <AnsiText :text="summary.error" />
        </div>
      </section>

      <section v-for="section in sections" :key="section.id">
        <div class="mb-1 flex items-center gap-2">
          <span class="font-semibold tracking-wide text-muted-foreground uppercase">{{ section.label }}</span>
          <button
            v-if="section.id === 'params'"
            type="button"
            class="ml-auto inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            @click="copyParams"
          >
            <Copy class="size-3" />
            Copy
          </button>
        </div>
        <div v-if="!section.rows.length" class="rounded-md border border-border bg-muted/20 p-2 text-muted-foreground">
          No additional params
        </div>
        <table v-else class="w-full overflow-hidden rounded-md border border-border text-xs">
          <tbody>
            <tr v-for="row in section.rows" :key="row.key" data-testid="call-row" class="group border-b border-border/40 last:border-0">
              <td class="w-36 bg-muted/30 px-2 py-1.5 align-top font-mono text-muted-foreground">
                {{ row.key }}
              </td>
              <td class="px-2 py-1.5 align-top font-mono whitespace-pre-wrap break-all text-foreground/90">
                {{ row.value }}
              </td>
              <td class="w-7 px-1 py-1 align-top">
                <button
                  v-if="row.copyable"
                  type="button"
                  :title="`Copy ${row.key}`"
                  class="flex size-5 items-center justify-center rounded text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-muted hover:text-foreground focus-visible:opacity-100"
                  @click="copyValue(`${section.id}:${row.key}`, row.value)"
                >
                  <component :is="copiedKey === `${section.id}:${row.key}` ? Check : Copy" class="size-3" />
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </section>
    </div>
  </div>
</template>
