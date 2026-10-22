import type { TraceModel } from '@isomorphic/trace/traceModel'

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
