<script setup lang="ts">
import type { ComponentHealth, StoryHealth, TestHealth } from '@kinora/core'
import { buildComponents, diagnose, HEALTH_WINDOW } from '@kinora/core'
import { Badge } from '@kinora/ui/badge'
import { Button } from '@kinora/ui/button'
import { Separator } from '@kinora/ui/separator'
import { Skeleton } from '@kinora/ui/skeleton'
import { StatBlock } from '@kinora/ui/stat-block'
import { ArrowLeft, ChevronDown, ChevronRight } from '@lucide/vue'
import { useRouteQuery } from '@vueuse/router'
import { computed, reactive } from 'vue'
import { RouterLink } from 'vue-router'
import A11yBadge from '@/components/a11y/A11yBadge.vue'
import A11yHotspots from '@/components/a11y/A11yHotspots.vue'
import CopyLinkButton from '@/components/app/CopyLinkButton.vue'
import ErrorState from '@/components/app/ErrorState.vue'
import SearchInput from '@/components/app/SearchInput.vue'
import StatStripSkeleton from '@/components/app/StatStripSkeleton.vue'
import StatusTimeline from '@/components/viz/StatusTimeline.vue'
import TestHealthBadge from '@/components/viz/TestHealthBadge.vue'
import TestStatusBadge from '@/components/viz/TestStatusBadge.vue'
import { useComponentHistory } from '@/composables/queries'
import { matchesHealth, useHealthFilter } from '@/composables/useHealthFilter'
import { useQuarantine } from '@/composables/useQuarantine'
import { testLabel } from '@/lib/test-display'

const props = defineProps<{ projectId: string }>()
const { state, isLoading, error, execute: reloadHistory } = useComponentHistory(props.projectId)
const { isQuarantined, reload: reloadQuarantines } = useQuarantine(props.projectId)
// Quarantines fail with the same outage as the history, so a retry reloads both.
function retry() {
  void reloadHistory()
  void reloadQuarantines()
}

const DOCS_URL = 'https://docs.kinora.dev/guides/component-testing/'
const VITEST_DOCS_URL = 'https://docs.kinora.dev/guides/vitest/'

// Same window and same flaky / broken rules as the Tests page, so a story and its tests agree.
const WINDOW = HEALTH_WINDOW

const project = computed(() => state.value.project)
const components = computed(() => buildComponents(state.value.histories))
const stories = computed(() => components.value.flatMap(c => c.stories))
const healthById = computed(() => new Map(stories.value.map(s => [s.id, diagnose(s.points)])))
function health(s: StoryHealth): TestHealth {
  return healthById.value.get(s.id) ?? { kind: 'stable' }
}
const flakyCount = computed(() => stories.value.filter(s => health(s).kind === 'flaky').length)
const brokenCount = computed(() => stories.value.filter(s => health(s).kind === 'broken').length)
const hasA11yIssues = (s: StoryHealth): boolean => !!s.a11y?.violations.length
const a11yCount = computed(() => stories.value.filter(hasA11yIssues).length)
// Shown only once a story records an a11y check, so suites without the addon see no empty stat.
const checksA11y = computed(() => stories.value.some(s => s.a11y))

const search = useRouteQuery<string>('q', '')
const filter = useHealthFilter('all')
const a11yOnly = useRouteQuery<string, boolean>('a11y', 'false', {
  transform: {
    get: v => v === 'true',
    set: v => (v ? 'true' : 'false'),
  },
})
const a11yGroups = computed(() => components.value.map(c => ({
  key: c.path,
  name: c.name || 'Other',
  violations: c.stories.flatMap(s => s.a11y?.violations ?? []),
})))
// A hotspot opens the stories of its component that break a rule.
function showA11yOf(path: string): void {
  search.value = path
  a11yOnly.value = true
}
const FILTERS = [
  { value: 'all', label: 'All stories', active: 'border-foreground/30 text-foreground' },
  { value: 'attention', label: 'Needs attention', active: 'border-flaky/50 text-flaky hover:text-flaky' },
  { value: 'flaky', label: 'Flaky', active: 'border-flaky/50 text-flaky hover:text-flaky' },
  { value: 'broken', label: 'Broken', active: 'border-fail/50 text-fail hover:text-fail' },
] as const
const EMPTY = {
  all: 'No stories match this filter.',
  attention: 'No flaky or broken stories. All green.',
  flaky: 'No flaky stories.',
  broken: 'No broken stories.',
  quarantined: 'No stories match this filter.',
} as const

// Tests sit folded under their story so a large catalog stays scannable. A story failing or
// flaky right now opens by default: that is where you would look first. The rest wait for a click.
const toggled = reactive(new Set<string>())
function isOpen(s: StoryHealth): boolean {
  const openByDefault = s.lastStatus === 'unexpected' || s.lastStatus === 'flaky'
  return openByDefault !== toggled.has(s.id)
}
function toggle(s: StoryHealth): void {
  if (!toggled.delete(s.id))
    toggled.add(s.id)
}
function testsLabel(s: StoryHealth): string {
  return `${s.tests.length} ${s.tests.length === 1 ? 'test' : 'tests'}`
}

// Filters apply per story; a component stays as long as one of its stories does.
const rows = computed<ComponentHealth[]>(() => {
  const q = search.value.trim().toLowerCase()
  return components.value
    .map(c => ({
      ...c,
      stories: c.stories.filter(s => matchesHealth(filter.value, health(s)) && (!a11yOnly.value || hasA11yIssues(s)) && (!q || s.id.toLowerCase().includes(q))),
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
      <div class="flex flex-col gap-6">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0 flex-1">
            <h1 class="text-2xl font-semibold tracking-tight">
              Components
            </h1>
            <Skeleton class="mt-1.5 mb-0.5 h-4 w-full max-w-xl" />
          </div>
          <CopyLinkButton class="shrink-0" />
        </div>
        <StatStripSkeleton :count="5" />
      </div>
      <div class="flex items-center justify-between gap-3" aria-hidden="true">
        <Skeleton class="h-8 w-[28rem] max-w-full" />
        <Skeleton class="h-9 w-72" />
      </div>
      <div class="flex flex-col gap-4" aria-hidden="true">
        <Skeleton v-for="i in 3" :key="i" class="h-48 rounded-lg" />
      </div>
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
          <StatBlock label="Flaky" :value="flakyCount" :tone="flakyCount ? 'flaky' : 'pass'" />
          <Separator orientation="vertical" class="h-10" />
          <StatBlock label="Broken" :value="brokenCount" :tone="brokenCount ? 'fail' : 'pass'" />
          <template v-if="checksA11y">
            <Separator orientation="vertical" class="h-10" />
            <StatBlock label="A11y issues" :value="a11yCount" :tone="a11yCount ? 'fail' : 'pass'" />
          </template>
        </div>
      </div>

      <div v-if="!components.length" class="rounded-lg border border-border/70 bg-card/80 px-6 py-12 text-center">
        <p class="text-sm font-medium">
          No component stories recorded yet.
        </p>
        <p class="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          This page tracks the health of each component story across runs and points out the flaky and broken ones.
        </p>
        <p class="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
          It fills in from Playwright component tests that import <code class="font-mono text-xs">test</code> from <code class="font-mono text-xs">@kinora/reporter/ct</code>, or from Storybook tests uploaded with <code class="font-mono text-xs">@kinora/vitest-reporter</code>.
        </p>
        <div class="mt-4 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 font-mono text-xs">
          <a :href="DOCS_URL" target="_blank" rel="noopener" class="text-signal hover:underline">
            Component testing guide
          </a>
          <a :href="VITEST_DOCS_URL" target="_blank" rel="noopener" class="text-signal hover:underline">
            Vitest and Storybook guide
          </a>
        </div>
      </div>

      <template v-else>
        <A11yHotspots :groups="a11yGroups" what="Components" @select="showA11yOf" />

        <!-- Toolbar -->
        <div class="flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <Button
              v-for="f in FILTERS"
              :key="f.value"
              variant="outline"
              size="sm"
              class="font-mono text-xs"
              :class="filter === f.value ? f.active : ''"
              @click="filter = f.value"
            >
              {{ f.label }}
            </Button>
            <Button
              v-if="checksA11y"
              variant="outline"
              size="sm"
              class="font-mono text-xs"
              :class="a11yOnly ? 'border-fail/50 text-fail hover:text-fail' : ''"
              :aria-pressed="a11yOnly"
              @click="a11yOnly = !a11yOnly"
            >
              A11y issues <span class="ml-1 tabular-nums text-muted-foreground">{{ a11yCount }}</span>
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
              <span v-if="c.path && c.path !== c.name" class="font-mono text-[11px] text-muted-foreground">{{ c.path }}</span>
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
                <!-- The timeline's cells are links, so they stay outside the toggle button. -->
                <button
                  type="button"
                  class="group flex min-w-0 items-center gap-2 text-left"
                  :aria-expanded="isOpen(s)"
                  :aria-controls="`tests-${s.id}`"
                  :aria-label="`${s.name}, ${testsLabel(s)}`"
                  @click="toggle(s)"
                >
                  <ChevronDown class="size-3.5 shrink-0 text-muted-foreground transition-transform" :class="isOpen(s) ? '' : '-rotate-90'" />
                  <TestStatusBadge :status="s.lastStatus" />
                  <span class="truncate text-sm font-medium group-hover:underline">{{ s.name }}</span>
                  <span class="shrink-0 font-mono text-[10px] text-muted-foreground">{{ testsLabel(s) }}</span>
                  <TestHealthBadge :health="health(s)" />
                  <A11yBadge :report="s.a11y" />
                </button>
                <div class="hidden w-40 sm:block">
                  <StatusTimeline :points="s.points" :project-id="projectId" :height="18" :slots="WINDOW" />
                </div>
              </div>
              <div v-if="isOpen(s)" :id="`tests-${s.id}`" class="flex flex-col gap-2 pl-5">
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
            </div>
          </section>

          <div v-if="!rows.length" class="py-12 text-center font-mono text-sm text-muted-foreground">
            {{ search ? 'No stories match this filter.' : EMPTY[filter] }}
          </div>
        </div>
      </template>
    </template>
  </div>
</template>
