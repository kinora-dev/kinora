<script setup lang="ts">
import type { NormTest, ProjectListing, RunReport, TestHistory } from '@kinora/core'
import { formatPct, passRate, stripAnsi } from '@kinora/core'
import { Button } from '@kinora/ui/button'
import { Card } from '@kinora/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@kinora/ui/tooltip'
import { Check, Copy, FileCode2, Play, RefreshCw, Sparkles } from '@lucide/vue'
import { computed, ref } from 'vue'

const props = defineProps<{
  project: ProjectListing
  report: RunReport | null
  histories: TestHistory[]
  loading: boolean
  linked: boolean
}>()
const emit = defineEmits<{
  viewTrace: [traceUrl: string]
  openInEditor: [loc: { file: string, line: number, column: number }]
  rerun: [t: { file: string, line: number, projectName: string, title: string }]
  // Launch the local fix agent on a failing test (same linked-repo requirement as re-run).
  fixTest: [t: { file: string, line: number, projectName: string, title: string, status: string, errors: string, traceUrl?: string }]
  // Re-run / Open need a linked repo; when absent, nudge the user to link first.
  requestLink: []
}>()

type Filter = 'failures' | 'regressions' | 'all'
const filter = ref<Filter>('failures')
const copiedKey = ref('')

const RANK: Record<string, number> = { unexpected: 0, flaky: 1, expected: 2, skipped: 3 }
const STRIP = 14
// A fresh regression: failing now but passed within the last N runs (broke recently, not chronic).
const REGRESSION_WINDOW = 5

function color(status: NormTest['status']): string {
  return status === 'unexpected'
    ? 'bg-fail'
    : status === 'flaky'
      ? 'bg-flaky'
      : status === 'expected'
        ? 'bg-pass'
        : 'bg-muted-foreground/40'
}
function isFailingStatus(s: NormTest['status']): boolean {
  return s === 'unexpected' || s === 'flaky'
}
function isFail(t: NormTest): boolean {
  return isFailingStatus(t.status)
}
function traceUrl(t: NormTest): string | undefined {
  return t.attachments.find(a => a.url && (a.name === 'trace' || a.contentType === 'application/zip'))?.url
}

// "Regressed" = failing now AND it passed within the last N runs (broke recently, hasn't recovered).
// Same notion as the Slack alert's "newly failing"; a test with no pass in the window is chronic, not fresh.
function regressed(h: TestHistory | undefined): boolean {
  const pts = h?.points
  if (!pts?.length || !isFailingStatus(pts[pts.length - 1].status))
    return false
  return pts.slice(-REGRESSION_WINDOW).some(p => p.status === 'expected')
}

// One label per test: this run's outcome, qualified by whether it just regressed.
function labelFor(t: NormTest, h: TestHistory | undefined): { text: string, cls: string } {
  const fresh = regressed(h)
  if (t.status === 'unexpected')
    return { text: fresh ? 'New break' : 'Failing', cls: 'text-fail' }
  if (t.status === 'flaky')
    return { text: fresh ? 'Newly flaky' : 'Flaky', cls: 'text-flaky' }
  if (t.status === 'expected')
    return { text: 'Passed', cls: 'text-pass' }
  return { text: 'Skipped', cls: 'text-muted-foreground' }
}
// Fail/flaky rate over exactly the runs shown in the strip, so the number matches the picture.
function rateOver(t: NormTest, strip: NormTest['status'][]): string {
  const executed = strip.filter(s => s !== 'skipped').length
  if (!executed)
    return ''
  if (t.status === 'unexpected') {
    const fails = strip.filter(s => s === 'unexpected').length
    return fails ? `${formatPct(fails / executed)} fail` : ''
  }
  if (t.status === 'flaky') {
    const flaky = strip.filter(s => s === 'flaky').length
    return flaky ? `${formatPct(flaky / executed)} flaky` : ''
  }
  return ''
}

const historyMap = computed(() => new Map(props.histories.map(h => [h.testKey, h])))

const allTests = computed(() => [...(props.report?.tests ?? [])].sort((a, b) => (RANK[a.status] ?? 9) - (RANK[b.status] ?? 9)))
const failed = computed(() => allTests.value.filter(isFail))
const rate = computed(() => (props.report ? passRate(props.report.counts) : 0))
const runDate = computed(() => (props.report
  ? new Date(props.report.startedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  : ''))

const regressedKeys = computed(() => new Set(
  failed.value.filter(t => regressed(historyMap.value.get(t.testKey))).map(t => t.testKey),
))

const filterOptions = computed(() => {
  const opts: { key: Filter, label: string }[] = []
  if (failed.value.length)
    opts.push({ key: 'failures', label: `Failing ${failed.value.length}` })
  if (regressedKeys.value.size)
    opts.push({ key: 'regressions', label: `Regressed ${regressedKeys.value.size}` })
  opts.push({ key: 'all', label: 'All' })
  return opts
})

// All-green: no Failing tab, so a stale 'failures' selection resolves to the first available ('all').
const effectiveFilter = computed<Filter>(() =>
  filterOptions.value.some(o => o.key === filter.value) ? filter.value : filterOptions.value[0].key,
)

const rows = computed(() => {
  const list = effectiveFilter.value === 'all'
    ? allTests.value
    : effectiveFilter.value === 'regressions'
      ? failed.value.filter(t => regressedKeys.value.has(t.testKey))
      : failed.value
  return list.map((test) => {
    const h = historyMap.value.get(test.testKey)
    const strip = h ? h.points.slice(-STRIP).map(p => p.status) : []
    return {
      test,
      fail: isFail(test),
      errorMsg: test.errors[0] ? stripAnsi(test.errors[0].message) : '',
      strip,
      // Pad the missing (older) runs with blank slots so every sparkline is STRIP wide.
      pad: Math.max(0, STRIP - strip.length),
      label: labelFor(test, h),
      rate: rateOver(test, strip),
      trace: traceUrl(test),
    }
  })
})

function errorText(test: NormTest): string {
  return test.errors.map(e => stripAnsi(e.stack ? `${e.message}\n${e.stack}` : e.message)).join('\n\n')
}

function fixTest(test: NormTest): void {
  emit('fixTest', {
    file: test.file,
    line: test.line,
    projectName: test.projectName,
    title: test.title,
    status: test.status,
    errors: errorText(test),
    traceUrl: traceUrl(test),
  })
}

async function copyPrompt(test: NormTest): Promise<void> {
  const errors = errorText(test)
  const prompt = `This Playwright test is failing. Find the root cause and fix it.

Test: ${test.title}
File: ${test.file}:${test.line}
Project: ${test.projectName}
Status: ${test.status}

Error:
${errors || '(no error captured)'}`
  await navigator.clipboard.writeText(prompt)
  copiedKey.value = test.testKey
  setTimeout(() => {
    if (copiedKey.value === test.testKey)
      copiedKey.value = ''
  }, 1500)
}
</script>

<template>
  <TooltipProvider :delay-duration="150">
    <div class="flex flex-col gap-5">
      <div class="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 class="text-xl font-semibold tracking-tight">
            {{ project.name }}
          </h1>
          <p class="mt-0.5 font-mono text-[11px] text-muted-foreground">
            latest run<span v-if="runDate"> · {{ runDate }}</span>
          </p>
        </div>
        <div v-if="report" class="flex items-center gap-4 font-mono text-xs tabular-nums">
          <span class="text-pass">{{ report.counts.expected }} passed</span>
          <span v-if="report.counts.unexpected" class="text-fail">{{ report.counts.unexpected }} failed</span>
          <span v-if="report.counts.flaky" class="text-flaky">{{ report.counts.flaky }} flaky</span>
          <span class="text-muted-foreground">{{ formatPct(rate) }}</span>
        </div>
      </div>

      <div v-if="loading" class="py-16 text-center font-mono text-sm text-muted-foreground">
        Loading latest run…
      </div>
      <div v-else-if="!report" class="py-16 text-center font-mono text-sm text-muted-foreground">
        No runs yet for this project.
      </div>
      <template v-else>
        <div
          v-if="regressedKeys.size"
          class="rounded-md border border-fail/30 bg-fail/5 px-3 py-2 font-mono text-[11px] text-fail"
        >
          {{ regressedKeys.size }} {{ regressedKeys.size === 1 ? 'test' : 'tests' }} started failing within the last {{ REGRESSION_WINDOW }} runs
        </div>

        <div class="flex items-center gap-1">
          <button
            v-for="opt in filterOptions"
            :key="opt.key"
            type="button"
            class="rounded-md px-2.5 py-1 font-mono text-[11px] tracking-wider uppercase transition-colors"
            :class="effectiveFilter === opt.key ? 'bg-accent text-foreground' : 'text-muted-foreground hover:text-foreground'"
            @click="filter = opt.key"
          >
            {{ opt.label }}
          </button>
        </div>

        <div v-if="rows.length === 0" class="flex flex-col items-center gap-1.5 py-14 text-center">
          <p class="text-sm text-muted-foreground">
            No tests.
          </p>
        </div>
        <Card v-else class="gap-0 divide-y divide-border/60 p-0">
          <div v-for="row in rows" :key="row.test.testKey" class="flex items-start gap-3 px-4 py-3">
            <span class="mt-1.5 size-1.5 shrink-0 rounded-full" :class="color(row.test.status)" />
            <div class="min-w-0 flex-1 space-y-1">
              <p class="truncate text-sm">
                {{ row.test.title }}
              </p>
              <p class="truncate font-mono text-[11px] text-muted-foreground">
                {{ row.test.file }}:{{ row.test.line }} · {{ row.test.projectName }}
              </p>
              <p v-if="row.errorMsg" class="line-clamp-2 font-mono text-[11px] text-fail/80">
                {{ row.errorMsg }}
              </p>
              <Tooltip v-if="row.strip.length || row.rate">
                <TooltipTrigger as-child>
                  <div class="flex w-fit cursor-help items-center gap-2 pt-0.5">
                    <div v-if="row.strip.length" class="flex items-center gap-[2px]">
                      <span v-for="i in row.pad" :key="`pad-${i}`" class="size-1.5 rounded-[1px] bg-muted/40" />
                      <span v-for="(s, i) in row.strip" :key="i" class="size-1.5 rounded-[1px]" :class="color(s)" />
                    </div>
                    <span v-if="row.rate" class="font-mono text-[10px] text-muted-foreground">{{ row.rate }}</span>
                  </div>
                </TooltipTrigger>
                <TooltipContent>Last {{ STRIP }} runs (oldest → newest)</TooltipContent>
              </Tooltip>
            </div>
            <div class="flex shrink-0 flex-col items-end gap-1.5">
              <span class="font-mono text-[11px] tracking-wider uppercase" :class="row.label.cls">
                {{ row.label.text }}
              </span>
              <div class="flex gap-1.5">
                <Tooltip v-if="row.fail">
                  <TooltipTrigger as-child>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 gap-1.5 font-mono text-[11px]"
                      :class="{ 'opacity-50': !linked }"
                      @click="linked ? emit('rerun', { file: row.test.file, line: row.test.line, projectName: row.test.projectName, title: row.test.title }) : emit('requestLink')"
                    >
                      <RefreshCw class="size-3" />
                      Re-run
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ linked ? 'Re-run this test locally' : 'Link a folder first' }}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger as-child>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 gap-1.5 font-mono text-[11px]"
                      :class="{ 'opacity-50': !linked }"
                      @click="linked ? emit('openInEditor', { file: row.test.file, line: row.test.line, column: row.test.column }) : emit('requestLink')"
                    >
                      <FileCode2 class="size-3" />
                      Open
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ linked ? 'Open in your editor' : 'Link a folder first' }}</TooltipContent>
                </Tooltip>
                <Tooltip v-if="row.fail">
                  <TooltipTrigger as-child>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 gap-1.5 font-mono text-[11px]"
                      :class="{ 'opacity-50': !linked }"
                      @click="linked ? fixTest(row.test) : emit('requestLink')"
                    >
                      <Sparkles class="size-3" />
                      Fix
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ linked ? 'Let a local agent propose a fix' : 'Link a folder first' }}</TooltipContent>
                </Tooltip>
                <Tooltip v-if="row.fail">
                  <TooltipTrigger as-child>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 gap-1.5 font-mono text-[11px]"
                      @click="copyPrompt(row.test)"
                    >
                      <Check v-if="copiedKey === row.test.testKey" class="size-3" />
                      <Copy v-else class="size-3" />
                      Prompt
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{{ copiedKey === row.test.testKey ? 'Copied' : 'Copy a fix prompt for an agent' }}</TooltipContent>
                </Tooltip>
                <Tooltip v-if="row.trace">
                  <TooltipTrigger as-child>
                    <Button
                      variant="outline"
                      size="sm"
                      class="h-7 gap-1.5 font-mono text-[11px]"
                      @click="emit('viewTrace', row.trace)"
                    >
                      <Play class="size-3" />
                      Trace
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Open the Playwright trace</TooltipContent>
                </Tooltip>
              </div>
            </div>
          </div>
        </Card>
      </template>
    </div>
  </TooltipProvider>
</template>
