import type { ActionEntry, ContextEntry } from '@isomorphic/trace/entries'
import type { StackFrame } from '@trace/trace'
import type { LocatorMatches } from './lib/locatorMatch'
import type { Snapshot, SnapshotTab } from './lib/snapshots'
import type { TimeRange } from './lib/timeline'
import { buildActionTree, TraceModel } from '@isomorphic/trace/traceModel'
import { useStorage } from '@vueuse/core'
import { computed, ref, shallowRef, watch } from 'vue'
import { actionTitle, actionTitleParts, filterTree } from './lib/action'
import { consoleEntries } from './lib/console'
import { allResources, resourcesForAction, resourcesInWindow } from './lib/network'
import { advance, indexAt } from './lib/playback'
import { collectSnapshots, snapshotInfoUrl, snapshotUrl } from './lib/snapshots'
import { actionInWindow, screencastFrames as buildScreencastFrames, inWindow, normalizeRange } from './lib/timeline'

export interface ActionItem {
  id: string
  depth: number
  hasChildren: boolean
  action: ActionEntry
}

export interface SnapshotInfo {
  url?: string
  viewport?: { width: number, height: number }
  // The snapshot URL this info describes, so the view applies it once that snapshot is shown.
  src?: string
}

export interface SnapshotQuery {
  kind: 'locator' | 'aria'
  text: string
}

export interface PickedLocator {
  selector: string
  locator: string
  // ARIA snapshot of the picked element, from the injected script.
  ariaSnapshot?: string
}

export interface ListedRow {
  item: ActionItem
  // An ancestor shown only to keep the tree shape around a filtered match.
  context: boolean
}

// Console and Network list either what led to the active action or the whole trace.
export type ListScope = 'selected' | 'all'

export const ACTION_GROUPS = ['getter', 'route', 'configuration'] as const
export type ActionGroup = typeof ACTION_GROUPS[number]

export const DETAIL_TABS = ['source', 'call', 'locator', 'log', 'network', 'attachments', 'errors', 'console', 'metadata', 'annotations'] as const
export type DetailTab = typeof DETAIL_TABS[number]
const DETAIL_TAB_KEY = 'kinora-tv-detail-tab'

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
watch(detailTab, tab => safeStorage()?.setItem(DETAIL_TAB_KEY, tab))
const actionFilter = ref('')
const consoleScope = ref<ListScope>('selected')
const networkScope = ref<ListScope>('selected')
const hiddenGroups = useStorage<ActionGroup[]>('kinora-tv-hidden-action-groups', [])
// Service-worker progress while a trace downloads and unzips; null when not reported yet.
const loadProgress = ref<{ done: number, total: number } | null>(null)
// Paints recorded <canvas> elements from the action screenshot (upstream "Display canvas content").
const canvasFromScreenshot = useStorage('kinora-tv-canvas-from-screenshot', false)
const sourceReveal = ref<SourceReveal | null>(null)
const networkReveal = ref<NetworkReveal | null>(null)
const attachmentReveal = ref<{ callId: string, version: number } | null>(null)
const pickedLocator = ref<PickedLocator | null>(null)
const inspectingLocator = ref(false)
// What was typed in the Locator tab; it stays while browsing actions, like upstream, until a new pick.
const editedLocator = ref<string | null>(null)
const editedAriaSnapshot = ref<string | null>(null)
// What the Locator tab wants resolved against the snapshot (the last edited of the two editors,
// like upstream's `lastEdited`), and how many elements it found.
const snapshotQuery = ref<SnapshotQuery | null>(null)
const queryMatches = ref<LocatorMatches | null>(null)
const playing = ref(false)
const PLAYBACK_SPEEDS = [0.25, 0.5, 1, 2] as const
const playbackSpeedIndex = ref(PLAYBACK_SPEEDS.indexOf(1))
const playbackSpeed = computed(() => PLAYBACK_SPEEDS[playbackSpeedIndex.value])
const playhead = ref<number | null>(null)
// When set, a brushed time window that filters/zooms every tab; null = follow the selected action.
const timeRange = ref<TimeRange | null>(null)
// A span another tab is pointing at (hovered console or network row), drawn on the timeline.
const highlightedTime = ref<TimeRange | null>(null)
const PENDING_LOAD_KEY = 'kinora.traceViewer.pendingLoad'
const SW_RELOAD_ATTEMPTS_KEY = 'kinora.traceViewer.swReloadAttempts'

interface PendingLoad {
  uri: string
  name: string
}

let playFrame: number | undefined
let pingTimer: ReturnType<typeof setInterval> | undefined
let loadGeneration = 0
let snapshotInfoGeneration = 0
let sourceRevealVersion = 0
let networkRevealVersion = 0
let attachmentRevealVersion = 0

// Reading `localStorage` throws where storage is blocked (sandboxed or third-party embeds).
function safeStorage(): Storage | undefined {
  try {
    return globalThis.localStorage
  }
  catch {
    return undefined
  }
}

// `?tab=` wins (links from the dashboard), then the tab picked last time.
function initialDetailTab(): DetailTab {
  const tab = new URLSearchParams(globalThis.location?.search ?? '').get('tab') ?? safeStorage()?.getItem(DETAIL_TAB_KEY)
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

let serviceWorkerReady: Promise<void> | undefined

// Started when the viewer boots, like upstream, so the one-time reload a fresh install may need
// happens before anything is dropped or pasted: an in-memory trace (`blob:`) cannot survive it.
function ensureServiceWorker(): Promise<void> {
  serviceWorkerReady ??= registerServiceWorker().catch((err) => {
    serviceWorkerReady = undefined
    throw err
  })
  return serviceWorkerReady
}

async function registerServiceWorker(): Promise<void> {
  if (!navigator.serviceWorker)
    throw new Error('Service workers unavailable. Serve over https or localhost.')
  navigator.serviceWorker.onmessage = (event: MessageEvent) => {
    if (event.data?.method === 'progress')
      loadProgress.value = event.data.params
  }
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
    const uri = traceUri.value
    if (status.value === 'loading' && uri && !uri.startsWith('blob:'))
      sessionStorage.setItem(PENDING_LOAD_KEY, JSON.stringify({ uri, name: traceName.value } satisfies PendingLoad))
    sessionStorage.setItem(SW_RELOAD_ATTEMPTS_KEY, String(attempts + 1))
    location.reload()
    await new Promise(() => {})
  }
  sessionStorage.removeItem(SW_RELOAD_ATTEMPTS_KEY)
  pingTimer ??= setInterval(() => {
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
  const generation = ++loadGeneration
  stopPlay()
  hoveredActionId.value = null
  status.value = 'loading'
  loadProgress.value = null
  errorKind.value = 'generic'
  traceUri.value = uri
  traceName.value = name
  try {
    await ensureServiceWorker()
    const res = await fetch(`contexts?trace=${encodeURIComponent(uri)}`)
    if (!res.ok)
      throw new Error(await parseErrorResponse(res))
    const contexts = await res.json() as ContextEntry[]
    // A newer load (drop, paste) started meanwhile: it owns the state now.
    if (generation !== loadGeneration)
      return
    const m = new TraceModel(uri, contexts)
    model.value = m
    items.value = flatten(m)
    collapsed.value = new Set()
    timeRange.value = null
    sourceReveal.value = null
    networkReveal.value = null
    pickedLocator.value = null
    editedLocator.value = null
    editedAriaSnapshot.value = null
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
    sessionStorage.removeItem(PENDING_LOAD_KEY)
    status.value = 'ready'
  }
  catch (err: any) {
    if (generation !== loadGeneration)
      return
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

// The rows the action list shows: collapsed steps, the text filter, hidden groups and the zoomed window.
const listedRows = computed<ListedRow[]>(() => {
  const f = actionFilter.value.trim().toLowerCase()
  const range = timeRange.value
  const sdkLanguage = model.value?.sdkLanguage
  const passesGroup = (action: ActionEntry): boolean => !action.group || !hiddenGroups.value.includes(action.group as ActionGroup)
  if (!f && !range) {
    return visibleItems.value
      .filter(item => passesGroup(item.action))
      .map(item => ({ item, context: false }))
  }
  // Filtering or zoomed: keep the steps leading to each match so the tree keeps its shape.
  return filterTree(items.value, (item) => {
    if (!passesGroup(item.action) || (range && !actionInWindow(item.action, range)))
      return false
    if (!f)
      return true
    const { subtitle } = actionTitleParts(item.action, sdkLanguage)
    return `${actionTitle(item.action)} ${subtitle ?? ''}`.toLowerCase().includes(f)
  })
})

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
const currentSnapshotUrl = computed(() => snapshotUrl(traceUri.value, currentSnapshot.value, { canvasFromScreenshot: canvasFromScreenshot.value }))

const boundaries = computed(() => {
  const m = model.value
  return { min: m?.startTime ?? 0, max: m?.endTime ?? 1 }
})

function setTimeRange(a: number, b: number): void {
  const { start, end } = normalizeRange(a, b)
  timeRange.value = end > start ? { start, end } : null
}

function zoomToAction(action: ActionEntry): void {
  // Unfinished actions have `endTime: 0`; zoom from their start to the trace end.
  setTimeRange(action.startTime, action.endTime || model.value?.endTime || action.startTime)
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

// Where the selection sits among the listed rows. A selection hidden by a collapsed step or a
// filter anchors on the last listed row before it, so stepping continues from there.
function listedPosition(): { index: number, exact: boolean } {
  const rows = listedRows.value
  const index = rows.findIndex(row => row.item.id === selectedId.value)
  if (index !== -1)
    return { index, exact: true }
  const selected = selectedIndex.value
  const order = new Map(items.value.map((item, i) => [item.id, i]))
  return { index: rows.findLastIndex(row => (order.get(row.item.id) ?? 0) < selected), exact: false }
}

function stepTarget(delta: number): ActionItem | undefined {
  const rows = listedRows.value
  const { index, exact } = listedPosition()
  if (index === -1)
    return delta > 0 ? rows[0]?.item : undefined
  return rows[exact || delta > 0 ? index + delta : index]?.item
}

// Arrow keys walk the rows on screen.
function step(delta: number): void {
  const item = stepTarget(delta)
  if (item)
    select(item.id)
}

function canStep(delta: number): boolean {
  return !!stepTarget(delta)
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

// What was running at `time`: the innermost action covering it, else the last one started before,
// else (before anything started) the first action.
function actionAt(time: number): ActionItem | undefined {
  let best: ActionItem | undefined
  let fallback: ActionItem | undefined
  for (const item of items.value) {
    const { startTime, endTime } = item.action
    if (startTime > time)
      continue
    if (!fallback || startTime >= fallback.action.startTime)
      fallback = item
    if ((!endTime || endTime >= time) && (!best || startTime >= best.action.startTime))
      best = item
  }
  return best ?? fallback ?? items.value.reduce<ActionItem | undefined>((first, item) => !first || item.action.startTime < first.action.startTime ? item : first, undefined)
}

function selectAtTime(time: number): void {
  const target = actionAt(time)
  if (target)
    select(target.id)
}

function setHighlightedTime(range: TimeRange | null): void {
  highlightedTime.value = range
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
  // Picking happens on the selected action's snapshot, not on a screencast frame.
  if (value)
    stopPlay()
  inspectingLocator.value = value
}

function pickLocator(locator: PickedLocator): void {
  pickedLocator.value = locator
  editedLocator.value = null
  editedAriaSnapshot.value = null
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

// What the Console tab lists, shared with its badge: a brushed window wins over the scope.
const scopedConsoleEntries = computed(() => {
  const m = model.value
  if (!m)
    return []
  const range = timeRange.value
  const action = activeAction.value
  let events = m.events
  let stdio = m.stdio
  if (range) {
    events = events.filter(e => inWindow(e.time, range))
    stdio = stdio.filter(e => inWindow(e.timestamp, range))
  }
  else if (consoleScope.value === 'selected') {
    events = action ? m.eventsForAction(action) : []
    stdio = action ? stdio.filter(e => e.timestamp >= action.startTime && e.timestamp <= (action.endTime || action.startTime)) : []
  }
  const pageTitle = (id: string | undefined) => (id && m.resourceOwnerRefToTitle.get(id)) || ''
  return consoleEntries({ events, stdio, pageTitle })
})

// What the Network tab lists before its own search and type filters, shared with its badge.
const scopedNetworkRows = computed(() => {
  const m = model.value
  const resources = m?.resources ?? []
  const context = { ownerTitles: m?.resourceOwnerRefToTitle, startTime: m?.startTime }
  const range = timeRange.value
  if (range)
    return resourcesInWindow(resources, range, context)
  return networkScope.value === 'all' ? allResources(resources, context) : resourcesForAction(resources, activeAction.value, context)
})

const playbackFrameUrl = computed(() => {
  const t = playhead.value
  const frames = screencastFrames.value
  return t === null ? undefined : frames[indexAt(frames, t, frame => frame.timestamp)]?.url
})

function cancelFrame(): void {
  if (playFrame !== undefined)
    cancelAnimationFrame(playFrame)
  playFrame = undefined
}

// Stop rewinds: the playhead goes away and the selected action's own snapshot shows again.
function stopPlay(): void {
  playing.value = false
  playhead.value = null
  cancelFrame()
}

// Pause keeps the playhead, so Play resumes from there and the screencast frame stays on screen.
function pausePlay(): void {
  playing.value = false
  cancelFrame()
}

function cyclePlaybackSpeed(): void {
  playbackSpeedIndex.value = (playbackSpeedIndex.value + 1) % PLAYBACK_SPEEDS.length
}

// Moves the playhead to `time` (the scrubber), following the action running there.
function scrubTo(time: number): void {
  pausePlay()
  playhead.value = time
  const item = actionAt(time)
  if (item && item.id !== selectedId.value)
    showSelection(item.id)
}

function togglePlay(): void {
  if (playing.value) {
    pausePlay()
    return
  }
  const list = playbackItems.value
  const m = model.value
  if (!list.length || !m)
    return
  const start = timeRange.value?.start ?? m.startTime
  const end = timeRange.value?.end ?? m.endTime
  const current = list.findIndex(item => item.id === selectedId.value)
  const resume = playhead.value !== null && playhead.value >= start && playhead.value < end ? playhead.value : undefined
  let t = resume ?? (current >= 0 && current < list.length - 1 ? Math.max(start, list[current].action.startTime) : start)
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
  const generation = ++snapshotInfoGeneration
  const infoUrl = snapshotInfoUrl(traceUri.value, currentSnapshot.value)
  const src = currentSnapshotUrl.value ?? 'about:blank'
  let info: SnapshotInfo = {}
  if (infoUrl) {
    try {
      const res = await fetch(infoUrl)
      info = res.ok ? await res.json() : {}
    }
    catch {}
  }
  // Stepping quickly: an older response must not overwrite the current snapshot's info.
  if (generation === snapshotInfoGeneration)
    snapshotInfo.value = { ...info, src }
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
    listedRows,
    actionFilter,
    consoleScope,
    networkScope,
    scopedConsoleEntries,
    scopedNetworkRows,
    hiddenGroups,
    canStep,
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
    selectAtTime,
    editedLocator,
    editedAriaSnapshot,
    snapshotQuery,
    queryMatches,
    loadProgress,
    canvasFromScreenshot,
    highlightedTime,
    setHighlightedTime,
    scrubTo,
    stopPlay,
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
    ensureServiceWorker,
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
