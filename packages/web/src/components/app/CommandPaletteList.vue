<script setup lang="ts">
import type { RunHealth, RunSummary } from '@kinora/core'
import type { PaletteCommand, RecentKind } from '@/composables/useCommandPalette'
import { partialRunLabel, pwStatusMeta, runHealth } from '@kinora/core'
import { CommandGroup, CommandInput, CommandItem, CommandList, useCommand } from '@kinora/ui/command'
import { colorMode } from '@kinora/ui/theme'
import { Blocks, BookOpen, Building2, CircleAlert, FlaskConical, FolderClosed, Gauge, GitCompareArrows, History, LayoutGrid, ListVideo, Monitor, Moon, Play, Settings, SlidersHorizontal, Sun } from '@lucide/vue'
import { watchDebounced } from '@vueuse/core'
import { injectListboxRootContext } from 'reka-ui'
import { computed, nextTick, ref, shallowRef, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useServerConfig } from '@/composables/queries'
import { GENERAL_GROUP, MODIFIER_KEY, useCommandPalette } from '@/composables/useCommandPalette'
import { useOrg } from '@/composables/useOrg'
import { reportQueryError } from '@/lib/errors'
import { formatDateTime } from '@/lib/format'
import { queryTerms, rankByQuery, runKeywords, runMatches, runRef } from '@/lib/palette'
import { session } from '@/lib/session'
import { testLabel } from '@/lib/test-display'
import { trpc } from '@/lib/trpc'

type TestHit = Awaited<ReturnType<typeof trpc.dashboard.searchTests.query>>[number]
type RunHit = Awaited<ReturnType<typeof trpc.dashboard.searchRuns.query>>[number]

const MIN_SEARCH_QUERY = 2
const HEALTH_DOT: Record<RunHealth, string> = { passing: 'bg-pass', flaky: 'bg-flaky', failing: 'bg-fail', empty: 'bg-muted-foreground' }

// A run missing shards has no health yet: a neutral dot, never a green one.
function runDot(run: RunSummary | undefined): string {
  return !run ? HEALTH_DOT.empty : partialRunLabel(run) ? 'bg-muted-foreground' : HEALTH_DOT[runHealth(run.counts)]
}
const RECENT_ICON = { project: FolderClosed, run: Play, test: FlaskConical } satisfies Record<RecentKind, unknown>
const THEMES = [
  { value: 'light', label: 'Light', icon: Sun },
  { value: 'dark', label: 'Dark', icon: Moon },
  { value: 'auto', label: 'System', icon: Monitor },
] as const

const route = useRoute()
const router = useRouter()
const listbox = injectListboxRootContext()
const { filterState } = useCommand()
const { open, sources, projects, projectRuns, refresh, remember, recentsOf } = useCommandPalette()
const { org, orgs, isAdmin, setActive } = useOrg()
const { state: serverConfig } = useServerConfig()

const currentProjectId = computed(() => typeof route.params.projectId === 'string' ? route.params.projectId : undefined)
void refresh(currentProjectId.value)

// A picked item clears the search just before the palette closes: stop following it then, or the
// list would flash back to its unfiltered state on the way out.
const query = ref('')
let closing = false
watch(() => filterState.search, (search) => {
  if (!closing)
    query.value = search
})
const terms = computed(() => queryTerms(query.value))

const currentProject = computed(() => projects.value.find(p => p.id === currentProjectId.value))

const pageCommands = computed(() => [...sources].flatMap(source => source()))

const projectCommands = computed<PaletteCommand[]>(() => {
  const project = currentProject.value
  if (!project)
    return []
  const params = { projectId: project.id }
  const runs = projectRuns.value?.projectId === project.id ? projectRuns.value.runs : []
  const failed = runs.find(r => runHealth(r.counts) === 'failing')
  const commands: PaletteCommand[] = [
    { id: 'project:runs', group: project.name, label: 'Run history', icon: ListVideo, to: { name: 'project', params } },
    { id: 'project:tests', group: project.name, label: 'Per-test history', keywords: 'tests flaky', icon: History, to: { name: 'tests', params } },
    { id: 'project:components', group: project.name, label: 'Components', keywords: 'stories storybook', icon: Blocks, to: { name: 'components', params } },
  ]
  if (runs[0])
    commands.push({ id: 'project:latest', group: project.name, label: 'Latest run', hint: formatDateTime(runs[0].startedAt), icon: Play, to: { name: 'run', params: { ...params, runId: runs[0].runId } } })
  if (failed)
    commands.push({ id: 'project:latest-failed', group: project.name, label: 'Latest failed run', keywords: 'failing failure', hint: formatDateTime(failed.startedAt), icon: CircleAlert, to: { name: 'run', params: { ...params, runId: failed.runId } } })
  if (runs[1])
    commands.push({ id: 'project:compare', group: project.name, label: 'Compare the last two runs', keywords: 'diff', icon: GitCompareArrows, to: { name: 'compare', params, query: { base: runs[1].runId, head: runs[0].runId } } })
  if (isAdmin.value)
    commands.push({ id: 'project:settings', group: project.name, label: 'Project settings', keywords: 'alerts slack codeowners rename delete', icon: Settings, to: { name: 'project-settings', params } })
  return commands
})

const recentCommands = computed<PaletteCommand[]>(() => {
  const orgId = org.value?.id
  if (!orgId)
    return []
  return recentsOf(orgId).map(r => ({ id: `recent:${r.id}`, group: 'Recent', label: r.label, detail: r.detail, hint: r.hint, icon: RECENT_ICON[r.kind], to: r.to }))
})

const projectListCommands = computed<PaletteCommand[]>(() => projects.value.map((project) => {
  const latest = project.latestRun
  return {
    id: `project:${project.id}`,
    group: 'Projects',
    label: project.name,
    keywords: project.id,
    dot: runDot(latest),
    hint: latest && formatDateTime(latest.startedAt),
    to: { name: 'project', params: { projectId: project.id } },
    recent: 'project',
  }
}))

// A project's inner pages, reached by typing its name and theirs ("web tests").
const projectPageCommands = computed<PaletteCommand[]>(() => projects.value.flatMap((project) => {
  const params = { projectId: project.id }
  return [
    { id: `project:${project.id}:tests`, group: 'Projects', label: `${project.name} › Per-test history`, keywords: `${project.id} tests flaky`, icon: History, to: { name: 'tests', params } },
    { id: `project:${project.id}:components`, group: 'Projects', label: `${project.name} › Components`, keywords: `${project.id} stories storybook`, icon: Blocks, to: { name: 'components', params } },
  ]
}))

// Server-side search, since a test or a run may be in any project. Earlier hits stay up while the
// next answer loads, narrowed locally so the list never shows something the query excludes.
const hits = shallowRef<{ tests: TestHit[], runs: RunHit[] }>({ tests: [], runs: [] })
const searching = ref(false)
const searchable = computed(() => query.value.trim().length >= MIN_SEARCH_QUERY)
let request = 0
watch(searchable, (on) => {
  searching.value = on
  if (!on) {
    request++
    hits.value = { tests: [], runs: [] }
  }
})
watchDebounced(query, async (q) => {
  if (!searchable.value)
    return
  const id = ++request
  searching.value = true
  try {
    const [tests, runs] = await Promise.all([
      trpc.dashboard.searchTests.query({ q, projectId: currentProjectId.value }),
      trpc.dashboard.searchRuns.query({ q }),
    ])
    if (id === request)
      hits.value = { tests, runs }
  }
  catch (error) {
    reportQueryError(error)
  }
  finally {
    if (id === request)
      searching.value = false
  }
}, { debounce: 150 })

const runCommands = computed<PaletteCommand[]>(() => hits.value.runs
  .filter(({ project, run }) => runMatches(terms.value, run, `${project.name} ${project.id}`))
  .map(({ project, run }) => {
    const number = run.ci?.runNumber
    return {
      id: `run:${run.runId}`,
      group: 'Runs',
      label: runRef(run) ?? formatDateTime(run.startedAt),
      keywords: runKeywords(run),
      detail: number ? `#${number}` : undefined,
      hint: `${project.name} · ${formatDateTime(run.startedAt)}`,
      dot: runDot(run),
      to: { name: 'run', params: { projectId: project.id, runId: run.runId } },
      recent: 'run',
    }
  }))

const testCommands = computed<PaletteCommand[]>(() => hits.value.tests
  .filter((hit) => {
    const text = `${hit.file} ${hit.titlePath.join(' ')} ${hit.projectName} ${hit.projectId}`.toLowerCase()
    return terms.value.every(term => text.includes(term))
  })
  .map(hit => ({
    id: `test:${hit.projectId}:${hit.testKey}`,
    group: 'Tests',
    label: testLabel(hit),
    detail: hit.file,
    hint: hit.projectName,
    dot: pwStatusMeta[hit.status].dot,
    to: { name: 'test', params: { projectId: hit.projectId }, query: { key: hit.testKey } },
    recent: 'test',
  })))

const navigationCommands = computed<PaletteCommand[]>(() => {
  const commands: PaletteCommand[] = [
    { id: 'go:overview', group: 'Go to', label: 'Overview', keywords: 'home projects', icon: LayoutGrid, to: { name: 'overview' } },
    { id: 'go:account', group: 'Go to', label: 'Account settings', keywords: 'profile email password theme', icon: Settings, to: { name: 'settings-account' } },
    { id: 'go:workspace', group: 'Go to', label: 'Workspace settings', keywords: 'team members invite billing plan usage api tokens mcp', icon: SlidersHorizontal, to: { name: 'settings-workspace' } },
  ]
  if (serverConfig.value?.adminEnabled && session.user.value?.role === 'admin')
    commands.push({ id: 'go:admin', group: 'Go to', label: 'Admin', icon: Gauge, to: { name: 'admin' } })
  return commands
})

const workspaceCommands = computed<PaletteCommand[]>(() => orgs.value
  .filter(o => o.id !== org.value?.id)
  .map(o => ({ id: `workspace:${o.id}`, group: 'Workspaces', label: `Switch to ${o.name}`, keywords: 'workspace organization', icon: Building2, run: () => setActive(o.id) })))

const generalCommands = computed<PaletteCommand[]>(() => [
  ...THEMES
    .filter(theme => theme.value !== colorMode.value)
    .map(theme => ({ id: `theme:${theme.value}`, group: GENERAL_GROUP, label: `Theme: ${theme.label}`, keywords: 'appearance color mode', icon: theme.icon, run: () => {
      colorMode.value = theme.value
    } })),
  { id: 'docs', group: GENERAL_GROUP, label: 'Documentation', keywords: 'docs help guide', icon: BookOpen, href: 'https://docs.kinora.dev' },
])

const sections = computed(() => {
  const filtering = terms.value.length > 0
  const match = (commands: PaletteCommand[]) => filtering ? rankByQuery(commands, terms.value) : commands
  const general = pageCommands.value.filter(c => c.group === GENERAL_GROUP)
  // A project page only shows up for a query its project doesn't answer alone, so typing a
  // project's name lists the project once.
  const matchedProjects = match(projectListCommands.value)
  const shown = new Set(matchedProjects.map(c => c.id))
  const projectPages = filtering
    ? match(projectPageCommands.value).filter(c => !shown.has(c.id.slice(0, c.id.lastIndexOf(':'))))
    : []

  const commands = [
    ...match(pageCommands.value.filter(c => c.group !== GENERAL_GROUP)),
    ...match(projectCommands.value),
    ...(filtering ? [] : recentCommands.value),
    ...matchedProjects,
    ...projectPages,
    ...runCommands.value,
    ...testCommands.value,
    ...match(navigationCommands.value),
    ...match(workspaceCommands.value),
    ...match([...generalCommands.value, ...general]),
  ].filter(c => !c.to || router.resolve(c.to).fullPath !== route.fullPath)

  const byGroup = new Map<string, PaletteCommand[]>()
  for (const command of commands)
    byGroup.set(command.group, [...(byGroup.get(command.group) ?? []), command])
  return [...byGroup].map(([heading, items]) => ({ heading, items }))
})

const commandsById = computed(() => new Map(sections.value.flatMap(s => s.items).map(c => [c.id, c])))

// Projects and test hits arrive after the first render. Until an arrow key picks a row, the
// highlight follows the top of the list; after that it only moves if its row went away.
let picked = false
watch(query, () => {
  picked = false
})
watch(commandsById, async () => {
  await nextTick()
  if (!picked || !listbox.highlightedElement.value?.isConnected)
    listbox.highlightFirstItem()
}, { flush: 'post' })

function execute(command: PaletteCommand, newTab: boolean): void {
  closing = true
  if (org.value)
    remember(org.value.id, command)
  if (command.href)
    window.open(command.href, '_blank', 'noopener')
  else if (command.to && newTab)
    window.open(router.resolve(command.to).href, '_blank')
  else if (command.to)
    void router.push(command.to)
  else
    void command.run?.()
  open.value = false
}

function withModifier(event: { metaKey: boolean, ctrlKey: boolean }): boolean {
  return event.metaKey || event.ctrlKey
}

function onArrow(): void {
  picked = true
}

function activeCommand(): PaletteCommand | undefined {
  const id = listbox.highlightedElement.value?.dataset.commandId
  return id ? commandsById.value.get(id) : sections.value[0]?.items[0]
}

function onEnter(event: KeyboardEvent): void {
  if (event.isComposing)
    return
  const command = activeCommand()
  if (!command)
    return
  event.preventDefault()
  event.stopPropagation()
  execute(command, withModifier(event))
}
</script>

<template>
  <div class="flex min-h-0 flex-col" @keydown.up.down="onArrow" @keydown.enter.capture="onEnter">
    <CommandInput placeholder="Search projects, runs, tests, or jump to..." class="font-mono text-xs" />
    <CommandList class="max-h-[min(26rem,60vh)]">
      <CommandGroup
        v-for="section in sections"
        :key="section.heading"
        :heading="section.heading"
        class="[&_[data-slot=command-group-heading]]:font-mono [&_[data-slot=command-group-heading]]:text-[11px] [&_[data-slot=command-group-heading]]:tracking-wider [&_[data-slot=command-group-heading]]:uppercase"
      >
        <CommandItem
          v-for="command in section.items"
          :key="command.id"
          :value="command.id"
          :data-command-id="command.id"
          class="gap-2.5 px-2.5 py-2 font-mono text-xs"
          @select="event => execute(command, withModifier(event.detail.originalEvent))"
        >
          <span v-if="command.dot" class="flex size-3.5 shrink-0 items-center justify-center">
            <span class="size-1.5 rounded-full" :class="command.dot" />
          </span>
          <component :is="command.icon" v-else-if="command.icon" class="size-3.5" />
          <span class="min-w-0 truncate">{{ command.label }}</span>
          <span v-if="command.detail" class="min-w-0 shrink-[99] truncate text-muted-foreground">{{ command.detail }}</span>
          <span v-if="command.hint" class="ml-auto shrink-0 pl-3 text-[11px] text-muted-foreground">{{ command.hint }}</span>
        </CommandItem>
      </CommandGroup>
      <p v-if="!sections.length" class="px-4 py-8 text-center font-mono text-xs text-muted-foreground">
        {{ searching ? 'Searching...' : query ? 'No results.' : 'Nothing here yet.' }}
      </p>
    </CommandList>
    <div class="flex items-center gap-4 border-t px-3 py-2 font-mono text-[11px] text-muted-foreground">
      <span><kbd class="font-mono">↑↓</kbd> navigate</span>
      <span><kbd class="font-mono">↵</kbd> open</span>
      <span><kbd class="font-mono">{{ MODIFIER_KEY }}↵</kbd> new tab</span>
      <span class="ml-auto"><kbd class="font-mono">esc</kbd> close</span>
    </div>
  </div>
</template>
