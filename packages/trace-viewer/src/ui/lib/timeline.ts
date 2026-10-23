import type { TraceModel } from '@isomorphic/trace/traceModel'
import { formatMs } from './format'

export interface TimeRange {
  start: number
  end: number
}

export function normalizeRange(a: number, b: number): TimeRange {
  return { start: Math.min(a, b), end: Math.max(a, b) }
}

// Pixel offset within a [0, width] track -> absolute time within [min, min + span].
export function xToTime(x: number, width: number, min: number, span: number): number {
  if (width <= 0)
    return min
  const clamped = Math.min(Math.max(x, 0), width)
  return min + (clamped / width) * span
}

export function inWindow(t: number | undefined, range: TimeRange): boolean {
  return t !== undefined && t >= range.start && t <= range.end
}

// An action belongs to the window when its [start, end] span intersects it.
export function actionInWindow(action: { startTime?: number, endTime?: number }, range: TimeRange): boolean {
  const start = action.startTime ?? 0
  const end = action.endTime ?? start
  return end >= range.start && start <= range.end
}

export interface ScreencastFrame {
  url: string
  timestamp: number
}

export function screencastFrames(model: TraceModel | null): ScreencastFrame[] {
  if (!model)
    return []
  return model.pages
    .flatMap(page => page.screencastFrames)
    .map(f => ({ url: model.createRelativeUrl(`file/${f.file}`), timestamp: f.timestamp }))
    .sort((a, b) => a.timestamp - b.timestamp)
}

export interface FilmstripTile<T> {
  frame: T
  time: number
}

export function filmstripTiles<T extends { timestamp: number }>(frames: readonly T[], min: number, max: number, count: number): FilmstripTile<T>[] {
  if (!frames.length || count <= 0 || max <= min)
    return []
  const span = max - min
  const out: FilmstripTile<T>[] = []
  let i = 0
  for (let tile = 0; tile < count; tile++) {
    const time = min + ((tile + 0.5) / count) * span
    while (i + 1 < frames.length && frames[i + 1].timestamp <= time)
      i++
    if (frames[i].timestamp <= time)
      out.push({ frame: frames[i], time })
  }
  return out
}

export interface PageFrames {
  pageId: string
  frames: ScreencastFrame[]
}

// One film strip row per page that recorded frames, like upstream.
export function pageScreencastFrames(model: TraceModel | null): PageFrames[] {
  if (!model)
    return []
  return model.pages
    .filter(page => page.screencastFrames.length)
    .map(page => ({
      pageId: page.pageId,
      frames: page.screencastFrames
        .map(f => ({ url: model.createRelativeUrl(`file/${f.file}`), timestamp: f.timestamp }))
        .sort((a, b) => a.timestamp - b.timestamp),
    }))
}

// The last frame shown at or before `time` (the first one before the page painted anything).
export function frameAt<T extends { timestamp: number }>(frames: readonly T[], time: number): T | undefined {
  let found: T | undefined
  for (const frame of frames) {
    if (frame.timestamp > time)
      break
    found = frame
  }
  return found ?? frames[0]
}

export interface RulerTick {
  time: number
  left: number
  label: string
}

const TICK_STEPS = [1, 2, 5]

// Evenly spaced ticks on round durations (1, 2, 5 × 10ⁿ ms), roughly `spacing` pixels apart.
export function rulerTicks(min: number, max: number, width: number, origin: number, spacing = 90): RulerTick[] {
  const span = max - min
  if (span <= 0 || width <= 0)
    return []
  const target = (span * spacing) / width
  const magnitude = 10 ** Math.floor(Math.log10(target))
  const step = (TICK_STEPS.find(s => s * magnitude >= target) ?? 10) * magnitude
  const ticks: RulerTick[] = []
  for (let offset = Math.ceil((min - origin) / step) * step; origin + offset <= max; offset += step) {
    const time = origin + offset
    ticks.push({ time, left: ((time - min) / span) * 100, label: formatMs(offset) })
  }
  return ticks
}
