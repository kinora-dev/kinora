<script setup lang="ts">
import type { ComponentHealth, StoryHealth } from '@kinora/core'
import { buildComponents, HEALTH_WINDOW, windowStats } from '@kinora/core'
import { Badge } from '@kinora/ui/badge'
import { Button } from '@kinora/ui/button'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { StatBlock } from '@kinora/ui/stat-block'
import { ArrowLeft, ChevronRight } from '@lucide/vue'
import { useRouteQuery } from '@vueuse/router'
import { computed } from 'vue'
import { RouterLink } from 'vue-router'
import CopyLinkButton from '@/components/app/CopyLinkButton.vue'
import ErrorState from '@/components/app/ErrorState.vue'
import SearchInput from '@/components/app/SearchInput.vue'
import StatusTimeline from '@/components/viz/StatusTimeline.vue'
import TestStatusBadge from '@/components/viz/TestStatusBadge.vue'
import { useProjectHistory } from '@/composables/queries'
import { useQuarantine } from '@/composables/useQuarantine'
import { testLabel } from '@/lib/test-display'

const props = defineProps<{ projectId: string }>()
const { state, isLoading, error, execute: reloadHistory } = useProjectHistory(props.projectId)
const { isQuarantined, reload: reloadQuarantines } = useQuarantine(props.projectId)
// Quarantines fail with the same outage as the history, so a retry reloads both.
function retry() {
  void reloadHistory()
  void reloadQuarantines()
}

const DOCS_URL = 'https://docs.kinora.dev/guides/component-testing/'

// Same window and same "unstable" rule as the Tests page, so a story and its tests agree.
const WINDOW = HEALTH_WINDOW

const project = computed(() => state.value.project)
const components = computed(() => buildComponents(state.value.histories))
const stories = computed(() => components.value.flatMap(c => c.stories))
const unstableIds = computed(() => new Set(stories.value.filter(s => windowStats(s.points).unstable).map(s => s.id)))
const failingCount = computed(() => stories.value.filter(s => s.lastStatus === 'unexpected').length)

const search = useRouteQuery('q', '')
const unstableOnly = useRouteQuery<string, boolean>('unstable', 'false', {
  transform: {
    get: v => v === 'true',
    set: v => (v ? 'true' : 'false'),
  },
})

function isUnstable(s: StoryHealth): boolean {
  return unstableIds.value.has(s.id)
}

// Filters apply per story; a component stays as long as one of its stories does.
const rows = computed<ComponentHealth[]>(() => {
  const q = search.value.trim().toLowerCase()
  return components.value
    .map(c => ({
      ...c,
      stories: c.stories.filter(s => (!unstableOnly.value || isUnstable(s)) && (!q || s.id.toLowerCase().includes(q))),
    }))
    .filter(c => c.stories.length)
})
</script>

<template>
  <div class="flex flex-col gap-8">
    <RouterLink
      :to="{ name: 'project', params: { projectId } }"
      class="flex w-fit items-center gap-1.5 font-mono text-xs text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-3.5" /> {{ project?.name ?? projectId }}
    </RouterLink>

    <ErrorState v-if="error" :error="error" @retry="retry()" />
    <template v-else-if="isLoading">
      <Skeleton class="h-24 rounded-xl" />
      <Skeleton class="h-96 rounded-xl" />
    </template>

    <template v-else>
      <div class="flex flex-col gap-6">
        <div class="flex items-start justify-between gap-4">
          <div>
            <h1 class="text-2xl font-semibold tracking-tight">
              Components
            </h1>
            <p class="mt-1 text-sm text-muted-foreground">
              Health of each component story over the last {{ WINDOW }} runs of {{ project?.name }}. A test that mounts several stories counts for each of them.
            </p>
          </div>
          <CopyLinkButton class="shrink-0" />
        </div>

        <div v-if="components.length" class="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-lg border border-border/70 bg-card/80 px-6 py-5">
          <StatBlock label="Components" :value="components.length" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Stories" :value="stories.length" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Unstable" :value="unstableIds.size" :tone="unstableIds.size ? 'flaky' : 'pass'" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Failing now" :value="failingCount" :tone="failingCount ? 'fail' : 'default'" />
        </div>
      </div>

      <div v-if="!components.length" class="rounded-lg border border-border/70 bg-card/80 px-6 py-12 text-center">
        <p class="text-sm font-medium">
          No component stories recorded yet.
        </p>
        <p class="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Import <code class="font-mono text-xs">test</code> from <code class="font-mono text-xs">@kinora/reporter/ct</code> in your Playwright component tests to see their health per story here.
        </p>
        <a :href="DOCS_URL" target="_blank" rel="noopener" class="mt-4 inline-block font-mono text-xs text-signal hover:underline">
          Component testing guide
        </a>
      </div>

      <template v-else>
        <!-- Toolbar -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              class="font-mono text-xs"
              :class="!unstableOnly ? 'border-foreground/30 text-foreground' : ''"
              @click="unstableOnly = false"
            >
              All stories
            </Button>
            <Button
              variant="outline"
              size="sm"
              class="font-mono text-xs"
              :class="unstableOnly ? 'border-flaky/50 text-flaky hover:text-flaky' : ''"
              @click="unstableOnly = true"
            >
              Unstable only
            </Button>
          </div>
          <SearchInput v-model="search" placeholder="Filter by component or story..." />
        </div>

        <!-- List -->
        <div class="flex flex-col gap-4">
          <section
            v-for="c in rows"
            :key="c.path"
            :aria-label="c.name || 'Other'"
            class="rounded-lg border border-border/70 bg-card/80"
          >
            <header class="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border/70 px-4 py-3">
              <h2 class="text-sm font-semibold">
                {{ c.name || 'Other' }}
              </h2>
              <span v-if="c.path" class="font-mono text-[11px] text-muted-foreground">{{ c.path }}</span>
              <span class="ml-auto font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                {{ c.stories.length }} {{ c.stories.length === 1 ? 'story' : 'stories' }}
              </span>
            </header>

            <div
              v-for="s in c.stories"
              :key="s.id"
              class="flex flex-col gap-2 border-b border-border/40 px-4 py-3 last:border-b-0"
            >
              <div class="grid grid-cols-[1fr_auto] items-center gap-4">
                <div class="flex min-w-0 items-center gap-2">
                  <TestStatusBadge :status="s.lastStatus" />
                  <span class="truncate text-sm font-medium">{{ s.name }}</span>
                </div>
                <div class="hidden w-40 sm:block">
                  <StatusTimeline :points="s.points" :project-id="projectId" :height="18" :slots="WINDOW" />
                </div>
              </div>
              <RouterLink
                v-for="t in s.tests"
                :key="t.testKey"
                :to="{ name: 'test', params: { projectId }, query: { key: t.testKey } }"
                class="group flex items-center gap-2 font-mono text-[11px] text-muted-foreground hover:text-foreground"
              >
                <TestStatusBadge :status="t.lastStatus" />
                <span class="truncate">{{ testLabel(t) }} · {{ t.file }}</span>
                <Badge v-if="isQuarantined(t.testKey)" class="border-flaky/30 bg-flaky/10 text-[10px] text-flaky">
                  Quarantined
                </Badge>
                <ChevronRight class="size-3 shrink-0 text-muted-foreground/50 transition-transform group-hover:translate-x-0.5" />
              </RouterLink>
            </div>
          </section>

          <div v-if="!rows.length" class="py-12 text-center font-mono text-sm text-muted-foreground">
            {{ unstableOnly && !search ? 'No unstable stories. All green.' : 'No stories match this filter.' }}
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
