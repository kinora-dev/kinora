import { describe, expect, it } from 'vitest'
import { actionInWindow, filmstripTiles, frameAt, inWindow, normalizeRange, pageScreencastFrames, rulerTicks, screencastFrames, xToTime } from '../src/ui/lib/timeline'

describe('normalizeRange', () => {
  it('orders the endpoints', () => {
    expect(normalizeRange(8, 3)).toEqual({ start: 3, end: 8 })
    expect(normalizeRange(3, 8)).toEqual({ start: 3, end: 8 })
  })
})

describe('xToTime', () => {
  it('maps a pixel offset to a time within the span', () => {
    expect(xToTime(50, 100, 1000, 200)).toBe(1100)
  })

  it('clamps out-of-range pixels to the edges', () => {
    expect(xToTime(-20, 100, 1000, 200)).toBe(1000)
    expect(xToTime(999, 100, 1000, 200)).toBe(1200)
  })

  it('returns min for a zero-width track', () => {
    expect(xToTime(50, 0, 1000, 200)).toBe(1000)
  })
})

describe('inWindow', () => {
  const range = { start: 10, end: 20 }
  it('includes the bounds and excludes outside', () => {
    expect(inWindow(10, range)).toBe(true)
    expect(inWindow(20, range)).toBe(true)
    expect(inWindow(9.9, range)).toBe(false)
    expect(inWindow(undefined, range)).toBe(false)
  })
})

describe('actionInWindow', () => {
  const range = { start: 10, end: 20 }
  it('keeps actions whose span intersects the window', () => {
    expect(actionInWindow({ startTime: 12, endTime: 15 }, range)).toBe(true)
    expect(actionInWindow({ startTime: 5, endTime: 11 }, range)).toBe(true)
    expect(actionInWindow({ startTime: 19, endTime: 30 }, range)).toBe(true)
  })

  it('drops actions fully outside', () => {
    expect(actionInWindow({ startTime: 1, endTime: 9 }, range)).toBe(false)
    expect(actionInWindow({ startTime: 21, endTime: 25 }, range)).toBe(false)
  })

  it('treats a missing endTime as an instant at startTime', () => {
    expect(actionInWindow({ startTime: 15 }, range)).toBe(true)
    expect(actionInWindow({ startTime: 25 }, range)).toBe(false)
  })
})

describe('screencastFrames', () => {
  it('is empty without a model', () => {
    expect(screencastFrames(null)).toEqual([])
  })

  it('flattens every page, sorted by timestamp, as viewer file URLs', () => {
    const model = {
      createRelativeUrl: (path: string) => `/viewer/${path}`,
      pages: [
        { screencastFrames: [{ file: 'b.jpeg', timestamp: 200 }] },
        { screencastFrames: [{ file: 'a.jpeg', timestamp: 100 }] },
      ],
    } as Parameters<typeof screencastFrames>[0]
    expect(screencastFrames(model)).toEqual([
      { url: '/viewer/file/a.jpeg', timestamp: 100 },
      { url: '/viewer/file/b.jpeg', timestamp: 200 },
    ])
  })
})

const frames = [{ timestamp: 100, id: 'a' }, { timestamp: 110, id: 'b' }, { timestamp: 120, id: 'c' }, { timestamp: 900, id: 'd' }]

describe('filmstripTiles', () => {
  it('is empty without frames, tiles or a time span', () => {
    expect(filmstripTiles([], 0, 1000, 10)).toEqual([])
    expect(filmstripTiles(frames, 0, 1000, 0)).toEqual([])
    expect(filmstripTiles(frames, 500, 500, 10)).toEqual([])
  })

  it('spreads tiles evenly and shows the frame current at each tile centre', () => {
    const tiles = filmstripTiles(frames, 0, 1000, 10)
    expect(tiles.map(t => t.time)).toEqual([150, 250, 350, 450, 550, 650, 750, 850, 950])
    expect(tiles.map(t => t.frame.id)).toEqual(['c', 'c', 'c', 'c', 'c', 'c', 'c', 'c', 'd'])
  })

  it('leaves out tiles before the first frame', () => {
    expect(filmstripTiles(frames, 0, 1000, 20)[0].time).toBe(125)
  })
})

describe('rulerTicks', () => {
  it('picks a round step about every 90px, labelled from the trace start', () => {
    const ticks = rulerTicks(1000, 2000, 900, 1000)
    expect(ticks.map(t => t.label)).toEqual(['0ms', '100ms', '200ms', '300ms', '400ms', '500ms', '600ms', '700ms', '800ms', '900ms', '1.0s'])
    expect(ticks[1].left).toBeCloseTo(10)
  })

  it('starts on the first round tick inside a zoomed window', () => {
    const ticks = rulerTicks(1130, 1180, 500, 1000)
    expect(ticks.map(t => t.label)).toEqual(['130ms', '140ms', '150ms', '160ms', '170ms', '180ms'])
  })

  it('uses 2 and 5 steps between powers of ten', () => {
    expect(rulerTicks(0, 1000, 450, 0).map(t => t.label).slice(0, 3)).toEqual(['0ms', '200ms', '400ms'])
    expect(rulerTicks(0, 5000, 900, 0).map(t => t.label).slice(0, 3)).toEqual(['0ms', '500ms', '1.0s'])
  })

  it('is empty without a span or width', () => {
    expect(rulerTicks(5, 5, 100, 0)).toEqual([])
    expect(rulerTicks(0, 10, 0, 0)).toEqual([])
  })
})

describe('frameAt', () => {
  const frames = [{ timestamp: 10 }, { timestamp: 20 }, { timestamp: 30 }]
  it('shows the last frame painted at that time, or the first one before any', () => {
    expect(frameAt(frames, 25)).toBe(frames[1])
    expect(frameAt(frames, 30)).toBe(frames[2])
    expect(frameAt(frames, 5)).toBe(frames[0])
    expect(frameAt([], 5)).toBeUndefined()
  })
})

describe('pageScreencastFrames', () => {
  it('keeps one sorted row per page that has frames', () => {
    const model = {
      createRelativeUrl: (p: string) => `/${p}`,
      pages: [
        { pageId: 'a', screencastFrames: [{ file: 'a2', timestamp: 2 }, { file: 'a1', timestamp: 1 }] },
        { pageId: 'b', screencastFrames: [] },
      ],
    } as any
    expect(pageScreencastFrames(model)).toEqual([{ pageId: 'a', frames: [{ url: '/file/a1', timestamp: 1 }, { url: '/file/a2', timestamp: 2 }] }])
  })
})
