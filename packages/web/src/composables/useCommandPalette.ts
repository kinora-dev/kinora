import type { ProjectListing, RunSummary } from '@kinora/core'
import type { Component } from 'vue'
import type { RouteLocationRaw } from 'vue-router'
import { useLocalStorage } from '@vueuse/core'
import { onScopeDispose, ref, shallowReactive, shallowRef, watch } from 'vue'
import { reportQueryError } from '@/lib/errors'
import { session } from '@/lib/session'
import { trpc } from '@/lib/trpc'

export type RecentKind = 'project' | 'run' | 'test'

export interface PaletteCommand {
  /** Unique across the whole palette. */
  id: string
  /** Heading the command is listed under. */
  group: string
  label: string
  /** Muted text after the label. */
  detail?: string
  /** Muted text at the end of the row. */
  hint?: string
  /** Extra words the command is found by, never shown. */
  keywords?: string
  icon?: Component
  /** Background class of a status dot, shown instead of the icon. */
  dot?: string
  /** One of: a route, an external link (always a new tab), or an action. */
  to?: RouteLocationRaw
  href?: string
  run?: () => unknown
  /** Set on a destination worth listing under "Recent" once opened. */
  recent?: RecentKind
}

// Where an app-wide command goes when the page registering it has no group of its own.
export const GENERAL_GROUP = 'General'

interface RecentEntry {
  org: string
  kind: RecentKind
  id: string
  label: string
  detail?: string
  hint?: string
  to: RouteLocationRaw
}

// Label of the key that opens the palette with K, and a row in a new tab with Enter.
export const MODIFIER_KEY = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl '

const RECENTS_PER_ORG = 5
const RECENTS_STORED = 30

const open = ref(false)
const sources = shallowReactive(new Set<() => PaletteCommand[]>())
const recents = useLocalStorage<RecentEntry[]>('kinora:palette:recent', [])

// Kept between two openings so the list is there at once, then refreshed on every opening.
const projects = shallowRef<ProjectListing[]>([])
// The newest runs of the project being viewed, for its shortcuts.
const projectRuns = shallowRef<{ projectId: string, runs: RunSummary[] } | null>(null)
watch(() => session.user.value?.id, () => {
  projects.value = []
  projectRuns.value = null
})

async function refresh(projectId: string | undefined): Promise<void> {
  try {
    const [listed, page] = await Promise.all([
      trpc.dashboard.projects.query(),
      projectId ? trpc.dashboard.projectRuns.query({ projectId }) : undefined,
    ])
    projects.value = listed
    projectRuns.value = page && projectId ? { projectId, runs: page.runs } : null
  }
  catch (error) {
    reportQueryError(error)
  }
}

function remember(org: string, command: PaletteCommand): void {
  if (!command.recent || !command.to)
    return
  const { recent: kind, id, label, detail, hint, to } = command
  const others = recents.value.filter(r => r.org !== org || r.id !== id)
  recents.value = [{ org, kind, id, label, detail, hint, to }, ...others].slice(0, RECENTS_STORED)
}

function recentsOf(org: string): RecentEntry[] {
  return recents.value.filter(r => r.org === org).slice(0, RECENTS_PER_ORG)
}

export function useCommandPalette() {
  return { open, sources, projects, projectRuns, refresh, remember, recentsOf }
}

// Adds commands to the palette for as long as the calling component lives: what a page or the
// header can do with state only it holds (the loaded run, a dialog it owns).
export function usePaletteCommands(source: () => PaletteCommand[]): void {
  sources.add(source)
  onScopeDispose(() => sources.delete(source))
}
