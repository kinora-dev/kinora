import type { RunSummary } from '@kinora/core'
import { defineComponent, h, ref } from 'vue'
import RunStrip from './RunStrip.vue'

function run(day: number, counts: Partial<RunSummary['counts']>): RunSummary {
  const full = { total: 10, expected: 10, unexpected: 0, flaky: 0, skipped: 0, ...counts }
  return { runId: `run-${day}`, projectId: 'web-app', startedAt: `2026-10-0${day}T12:00:00Z`, duration: 60_000, counts: full, reportPath: '', countsByTag: {} }
}

// Deliberately out of order: the strip sorts runs oldest first.
const RUNS = [
  run(3, { expected: 6, unexpected: 4 }),
  run(1, {}),
  run(2, { expected: 9, flaky: 1 }),
  run(4, {}),
]

// Records the run a bar selects, for the test to assert on.
export const Default = defineComponent(() => {
  const selected = ref('none')
  return () => [
    h('div', { class: 'w-48' }, [h(RunStrip, { runs: RUNS, onSelect: (picked: RunSummary) => (selected.value = picked.runId) })]),
    h('output', { 'data-testid': 'selected' }, selected.value),
  ]
})
