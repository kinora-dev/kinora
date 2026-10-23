import type { ActionEntry, ContextEntry } from '@isomorphic/trace/entries'
import type { StackFrame } from '@trace/trace'
import type { Snapshot, SnapshotTab } from './lib/snapshots'
import type { TimeRange } from './lib/timeline'
import { buildActionTree, TraceModel } from '@isomorphic/trace/traceModel'
import { computed, ref, shallowRef } from 'vue'
import { advance, indexAt } from './lib/playback'
import { collectSnapshots, snapshotInfoUrl, snapshotUrl } from './lib/snapshots'
import { actionInWindow, screencastFrames as buildScreencastFrames, normalizeRange } from './lib/timeline'

export interface ActionItem {
  id: string
  depth: number
  hasChildren: boolean
  action: ActionEntry
}

export interface SnapshotInfo {
  url?: string
  viewport?: { width: number, height: number }
}

export interface PickedLocator {
  selector: string
  locator: string
}

export const DETAIL_TABS = ['source', 'call', 'locator', 'log', 'network', 'attachments', 'errors', 'console', 'metadata', 'annotations'] as const
export type DetailTab = typeof DETAIL_TABS[number]

type Status = 'idle' | 'loading' | 'ready' | 'error'
type LoadErrorKind = 'generic' | 'unsupported-trace-version'

interface SourceReveal {
  stack: StackFrame[]
  version: number
}

interface NetworkReveal {
  resourceId: string
  version: number
}

const status = ref<Status>('idle')
const errorMessage = ref('')
const errorKind = ref<LoadErrorKind>('generic')
const traceUri = ref('')
// Display name for a trace opened from disk; remote traces show their URL instead.
const traceName = ref('')
const model = shallowRef<TraceModel | null>(null)
const items = shallowRef<ActionItem[]>([])
const collapsed = ref<Set<string>>(new Set())
const selectedId = ref<string | null>(null)
const hoveredActionId = ref<string | null>(null)
const snapshotTab = ref<SnapshotTab>('action')
const snapshotInfo = ref<SnapshotInfo>({})
const detailTab = ref<DetailTab>(initialDetailTab())
const sourceReveal = ref<SourceReveal | null>(null)
const networkReveal = ref<NetworkReveal | null>(null)
const attachmentReveal = ref<{ callId: string, version: number } | null>(null)
const pickedLocator = ref<PickedLocator | null>(null)
const inspectingLocator = ref(false)
const playing = ref(false)
const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2] as const
const playbackSpeedIndex = ref(PLAYBACK_SPEEDS.indexOf(1))
const playbackSpeed = computed(() => PLAYBACK_SPEEDS[playbackSpeedIndex.value])
const playhead = ref<number | null>(null)
// When set, a brushed time window that filters/zooms every tab; null = follow the selected action.
const timeRange = ref<TimeRange | null>(null)
const PENDING_LOAD_KEY = 'kinora.traceViewer.pendingLoad'
const SW_RELOAD_ATTEMPTS_KEY = 'kinora.traceViewer.swReloadAttempts'

interface PendingLoad {
  uri: string
  name: string
}

let playFrame: number | undefined
let sourceRevealVersion = 0
let networkRevealVersion = 0
let attachmentRevealVersion = 0

function initialDetailTab(): DetailTab {
  const tab = new URLSearchParams(globalThis.location?.search ?? '').get('tab')
  return DETAIL_TABS.find(id => id === tab) ?? 'source'
}

function flatten(m: TraceModel): ActionItem[] {
  const { rootItem } = buildActionTree(m.actions)
  const out: ActionItem[] = []
  const visit = (node: typeof rootItem, depth: number): void => {
    for (const child of node.children) {
      out.push({ id: child.id, depth, hasChildren: child.children.length > 0, action: child.action })
      visit(child, depth + 1)
    }
  }
  visit(rootItem, 0)
  return out
}

async function registerServiceWorker(uri: string, name: string): Promise<void> {
  if (!navigator.serviceWorker)
    throw new Error('Service workers unavailable. Serve over https or localhost.')
  const registration = await navigator.serviceWorker.register('sw.bundle.js', { updateViaCache: 'none' })
  await registration.update()
  if (!navigator.serviceWorker.controller) {
    await Promise.race([
      new Promise<void>((resolve) => { navigator.serviceWorker.oncontrollerchange = () => resolve() }),
      new Promise(resolve => setTimeout(resolve, 1500)),
    ])
  }
  if (!navigator.serviceWorker.controller) {
    const attempts = Number(sessionStorage.getItem(SW_RELOAD_ATTEMPTS_KEY) ?? '0')
    if (attempts >= 1)
      throw new Error('Service worker registered but did not control this page. Reload the viewer and try again.')
    sessionStorage.setItem(PENDING_LOAD_KEY, JSON.stringify({ uri, name } satisfies PendingLoad))
    sessionStorage.setItem(SW_RELOAD_ATTEMPTS_KEY, String(attempts + 1))
    location.reload()
    await new Promise(() => {})
  }
  setInterval(() => {
    void fetch('ping')
  }, 10_000)
}

function consumePendingLoad(): PendingLoad | null {
  const raw = sessionStorage.getItem(PENDING_LOAD_KEY)
  sessionStorage.removeItem(PENDING_LOAD_KEY)
  if (!raw)
    return null
  try {
    return JSON.parse(raw) as PendingLoad
  }
  catch {
    return null
  }
}

async function load(uri: string, name = ''): Promise<void> {
  stopPlay()
  status.value = 'loading'
  errorKind.value = 'generic'
  traceUri.value = uri
  traceName.value = name
  try {
    await registerServiceWorker(uri, name)
    const res = await fetch(`contexts?trace=${encodeURIComponent(uri)}`)
    if (!res.ok)
      throw new Error(await parseErrorResponse(res))
    const contexts = await res.json() as ContextEntry[]
    const m = new TraceModel(uri, contexts)
    model.value = m
    items.value = flatten(m)
    collapsed.value = new Set()
    timeRange.value = null
    sourceReveal.value = null
    networkReveal.value = null
    pickedLocator.value = null
    inspectingLocator.value = false
    // Default selection: failed action, else the last page action with a
    // snapshot (most representative page state), else the first action.
    const failed = m.failedAction()
    const lastWithPage = [...items.value].reverse().find(i =>
      m.hasDomSnapshotForCall(i.action.callId, 'after')
      || m.hasDomSnapshotForCall(i.action.callId, 'action')
      || m.hasDomSnapshotForCall(i.action.callId, 'before'),
    )
    selectedId.value = (failed?.callId ?? lastWithPage?.id ?? items.value[0]?.id) ?? null
    sessionStorage.removeItem(SW_RELOAD_ATTEMPTS_KEY)
    sessionStorage.removeItem(PENDING_LOAD_KEY)
    status.value = 'ready'
  }
  catch (err: any) {
    errorMessage.value = err?.message ?? String(err)
    errorKind.value = isUnsupportedTraceVersion(errorMessage.value) ? 'unsupported-trace-version' : 'generic'
    status.value = 'error'
  }
}

async function parseErrorResponse(res: Response): Promise<string> {
  const text = await res.text()
  try {
    const data = JSON.parse(text) as { error?: string, message?: string }
    return data.error ?? data.message ?? text
  }
  catch {
    return text
  }
}

function isUnsupportedTraceVersion(message: string): boolean {
  return message.includes('created by a newer version of Playwright') || message.includes('newer version of Playwright')
}

// Opening a trace from disk stays entirely client-side: the object URL is fetched
// by the service worker, which range-reads the zip exactly as for a remote trace.
// Nothing is uploaded.
let objectUrl: string | null = null

async function loadFile(file: File): Promise<void> {
  if (objectUrl)
    URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(file)
  await load(objectUrl, file.name)
}

// Hide descendants of collapsed nodes: skip rows deeper than the last collapsed one.
const visibleItems = computed<ActionItem[]>(() => {
  const out: ActionItem[] = []
  let hiddenDepth = Infinity
  for (const it of items.value) {
    if (it.depth > hiddenDepth)
      continue
    hiddenDepth = Infinity
    out.push(it)
    if (it.hasChildren && collapsed.value.has(it.id))
      hiddenDepth = it.depth
  }
  return out
})

function toggleCollapse(id: string): void {
  const next = new Set(collapsed.value)
  if (next.has(id))
    next.delete(id)
  else
    next.add(id)
  collapsed.value = next
}

function setHoveredAction(id: string | null): void {
  hoveredActionId.value = id
}

const selectedIndex = computed(() => items.value.findIndex(i => i.id === selectedId.value))
const selectedAction = computed<ActionEntry | undefined>(() => items.value[selectedIndex.value]?.action)
// What the snapshot and detail tabs show: a hovered action previews over the selection, like upstream.
const activeAction = computed<ActionEntry | undefined>(() =>
  (hoveredActionId.value && items.value.find(i => i.id === hoveredActionId.value)?.action) || selectedAction.value)
const snapshots = computed(() => collectSnapshots(model.value, activeAction.value))
const currentSnapshot = computed<Snapshot | undefined>(() => snapshots.value[snapshotTab.value])
const currentSnapshotUrl = computed(() => snapshotUrl(traceUri.value, currentSnapshot.value))

const boundaries = computed(() => {
  const m = model.value
  return { min: m?.startTime ?? 0, max: m?.endTime ?? 1 }
})

function setTimeRange(a: number, b: number): void {
  const { start, end } = normalizeRange(a, b)
  timeRange.value = end > start ? { start, end } : null
}

function zoomToAction(action: ActionEntry): void {
  const start = action.startTime ?? 0
  const end = action.endTime ?? start
  setTimeRange(start, end)
}

function clearTimeRange(): void {
  timeRange.value = null
}

function showSelection(id: string): void {
  selectedId.value = id
  sourceReveal.value = null
  pickedLocator.value = null
}

function select(id: string): void {
  stopPlay()
  showSelection(id)
}

function selectIndex(index: number): void {
  const item = items.value[index]
  if (item)
    select(item.id)
}

// Arrow keys walk the rows on screen, skipping children of collapsed steps.
function step(delta: number): void {
  const rows = visibleItems.value
  const index = rows.findIndex(i => i.id === selectedId.value)
  const item = rows[index === -1 ? 0 : index + delta]
  if (item)
    select(item.id)
}

// Left collapses an open step, otherwise moves to the parent step.
function collapseOrParent(): void {
  const index = selectedIndex.value
  const item = items.value[index]
  if (!item)
    return
  if (item.hasChildren && !collapsed.value.has(item.id)) {
    toggleCollapse(item.id)
    return
  }
  const parent = items.value.slice(0, index).findLast(i => i.depth < item.depth)
  if (parent)
    select(parent.id)
}

// Right expands a collapsed step, otherwise moves to its first child.
function expandOrChild(): void {
  const index = selectedIndex.value
  const item = items.value[index]
  if (!item?.hasChildren)
    return
  if (collapsed.value.has(item.id))
    toggleCollapse(item.id)
  else
    select(items.value[index + 1].id)
}

function revealConsole(id: string): void {
  select(id)
  detailTab.value = 'console'
}

function revealAttachment(id: string): void {
  select(id)
  const callId = items.value.find(i => i.id === id)?.action.callId
  if (callId)
    attachmentReveal.value = { callId, version: ++attachmentRevealVersion }
  detailTab.value = 'attachments'
}

function setTab(tab: SnapshotTab): void {
  snapshotTab.value = tab
}

function setDetailTab(tab: DetailTab): void {
  detailTab.value = tab
}

function revealSource(stack: StackFrame[]): void {
  sourceReveal.value = { stack, version: ++sourceRevealVersion }
  detailTab.value = 'source'
}

function revealNetworkResource(resourceId: string): void {
  networkReveal.value = { resourceId, version: ++networkRevealVersion }
  detailTab.value = 'network'
}

function setInspectingLocator(value: boolean): void {
  inspectingLocator.value = value
}

function pickLocator(locator: PickedLocator): void {
  pickedLocator.value = locator
  inspectingLocator.value = false
  detailTab.value = 'locator'
}

const playbackItems = computed(() => {
  const range = timeRange.value
  return items.value
    .filter(item => !range || actionInWindow(item.action, range))
    .sort((a, b) => a.action.startTime - b.action.startTime)
})

const screencastFrames = computed(() => buildScreencastFrames(model.value))

const playbackFrameUrl = computed(() => {
  const t = playhead.value
  const frames = screencastFrames.value
  return t === null ? undefined : frames[indexAt(frames, t, frame => frame.timestamp)]?.url
})

function stopPlay(): void {
  playing.value = false
  playhead.value = null
  if (playFrame !== undefined)
    cancelAnimationFrame(playFrame)
  playFrame = undefined
}

function cyclePlaybackSpeed(): void {
  playbackSpeedIndex.value = (playbackSpeedIndex.value + 1) % PLAYBACK_SPEEDS.length
}

function togglePlay(): void {
  if (playing.value) {
    stopPlay()
    return
  }
  const list = playbackItems.value
  const m = model.value
  if (!list.length || !m)
    return
  const start = timeRange.value?.start ?? m.startTime
  const end = timeRange.value?.end ?? m.endTime
  const current = list.findIndex(item => item.id === selectedId.value)
  let t = current >= 0 && current < list.length - 1 ? Math.max(start, list[current].action.startTime) : start
  let last: number | undefined
  playing.value = true
  const tick = (now: number): void => {
    if (!playing.value)
      return
    if (last !== undefined)
      t = advance(t, now - last, playbackSpeed.value, end)
    last = now
    playhead.value = t
    const item = list[indexAt(list, t, entry => entry.action.startTime)]
    if (item && item.id !== selectedId.value)
      showSelection(item.id)
    if (t >= end) {
      stopPlay()
      return
    }
    playFrame = requestAnimationFrame(tick)
  }
  playFrame = requestAnimationFrame(tick)
}

async function refreshSnapshotInfo(): Promise<void> {
  const infoUrl = snapshotInfoUrl(traceUri.value, currentSnapshot.value)
  if (!infoUrl) {
    snapshotInfo.value = {}
    return
  }
  try {
    const res = await fetch(infoUrl)
    snapshotInfo.value = res.ok ? await res.json() : {}
  }
  catch {
    snapshotInfo.value = {}
  }
}

export function useTraceStore() {
  return {
    status,
    errorMessage,
    errorKind,
    traceUri,
    traceName,
    model,
    items,
    visibleItems,
    collapsed,
    toggleCollapse,
    hoveredActionId,
    setHoveredAction,
    selectedId,
    selectedIndex,
    selectedAction,
    activeAction,
    attachmentReveal,
    collapseOrParent,
    expandOrChild,
    revealAttachment,
    revealConsole,
    snapshotTab,
    snapshots,
    currentSnapshot,
    currentSnapshotUrl,
    snapshotInfo,
    detailTab,
    sourceReveal,
    networkReveal,
    pickedLocator,
    inspectingLocator,
    playing,
    playbackSpeed,
    playhead,
    playbackFrameUrl,
    timeRange,
    boundaries,
    load,
    loadFile,
    consumePendingLoad,
    select,
    selectIndex,
    step,
    setTab,
    setDetailTab,
    revealSource,
    revealNetworkResource,
    setInspectingLocator,
    pickLocator,
    togglePlay,
    cyclePlaybackSpeed,
    setTimeRange,
    zoomToAction,
    clearTimeRange,
    refreshSnapshotInfo,
  }
}
