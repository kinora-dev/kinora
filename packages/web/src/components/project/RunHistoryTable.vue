<script setup lang="ts">
import type { RunSummary } from '@kinora/core'
import { formatDuration, formatPct, passRate } from '@kinora/core'
import { Button } from '@kinora/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@kinora/ui/table'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { useRouter } from 'vue-router'
import RunHealthBadge from '@/components/viz/RunHealthBadge.vue'
import { formatDateTime } from '@/lib/format'

defineProps<{ runs: RunSummary[], total: number, projectId: string, hasNewer: boolean, hasOlder: boolean, loading: boolean }>()
defineEmits<{ newer: [], older: [] }>()

const router = useRouter()

const headerCols = [
  { id: 'run', label: 'Run', right: false },
  { id: 'health', label: 'Health', right: false },
  { id: 'pass', label: 'Pass rate', right: true },
  { id: 'fail', label: 'Failed', right: true },
  { id: 'flaky', label: 'Flaky', right: true },
  { id: 'duration', label: 'Duration', right: true },
  { id: 'sha', label: 'SHA', right: true },
] as const
</script>

<template>
  <div class="rounded-xl border border-border/70 bg-card/80 overflow-hidden" :aria-busy="loading">
    <Table>
      <TableHeader>
        <TableRow class="hover:bg-transparent">
          <TableHead
            v-for="col in headerCols"
            :key="col.id"
            class="font-mono text-[10px] uppercase tracking-wider"
            :class="col.right ? 'text-right' : ''"
          >
            {{ col.label }}
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow
          v-for="run in runs"
          :key="run.runId"
          class="cursor-pointer"
          @click="router.push({ name: 'run', params: { projectId, runId: run.runId } })"
        >
          <TableCell class="font-mono text-xs">
            {{ formatDateTime(run.startedAt) }}
          </TableCell>
          <TableCell><RunHealthBadge :run="run" /></TableCell>
          <TableCell class="text-right font-mono text-xs tabular-nums">
            {{ formatPct(passRate(run.counts)) }}
          </TableCell>
          <TableCell class="text-right font-mono text-xs tabular-nums" :class="run.counts.unexpected ? 'text-fail' : 'text-muted-foreground'">
            {{ run.counts.unexpected }}
          </TableCell>
          <TableCell class="text-right font-mono text-xs tabular-nums" :class="run.counts.flaky ? 'text-flaky' : 'text-muted-foreground'">
            {{ run.counts.flaky }}
          </TableCell>
          <TableCell class="text-right font-mono text-xs tabular-nums text-muted-foreground">
            {{ formatDuration(run.duration) }}
          </TableCell>
          <TableCell class="text-right font-mono text-xs text-muted-foreground">
            {{ run.git?.sha ? run.git.sha.slice(0, 7) : '-' }}
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>

    <div v-if="hasNewer || hasOlder" class="flex items-center justify-between gap-4 border-t border-border/70 px-4 py-3">
      <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {{ total }} runs
      </span>
      <div class="flex items-center gap-1 font-mono">
        <Button variant="ghost" size="sm" class="text-xs text-muted-foreground" :disabled="!hasNewer || loading" @click="$emit('newer')">
          <ChevronLeft class="size-3.5" /> Newer
        </Button>
        <Button variant="ghost" size="sm" class="text-xs text-muted-foreground" :disabled="!hasOlder || loading" @click="$emit('older')">
          Older <ChevronRight class="size-3.5" />
        </Button>
      </div>
    </div>
  </div>
</template>
