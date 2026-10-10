import type { RouteLocationNormalized, Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isChunkLoadError, isNewBuild, watchForUpdates } from '@/lib/updates'

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }))
vi.mock('vue-sonner', () => ({ toast }))

function fetcher(res: Partial<Response> | Error) {
  return vi.fn(async () => {
    if (res instanceof Error)
      throw res
    return res as Response
  }) as unknown as typeof fetch
}

describe('isChunkLoadError', () => {
  it.each([
    'Failed to fetch dynamically imported module: https://app.kinora.dev/assets/RunPage-abc.js',
    'error loading dynamically imported module: https://app.kinora.dev/assets/RunPage-abc.js',
    'Importing a module script failed.',
  ])('matches %s', (message) => {
    expect(isChunkLoadError(new TypeError(message))).toBe(true)
  })

  it('ignores other errors', () => {
    expect(isChunkLoadError(new Error('Unauthorized'))).toBe(false)
    expect(isChunkLoadError('Failed to fetch dynamically imported module')).toBe(false)
  })
})

describe('isNewBuild', () => {
  it('is true when the deployed build differs', async () => {
    expect(await isNewBuild('a', fetcher({ ok: true, json: async () => ({ build: 'b' }) }))).toBe(true)
  })

  it('is false for the same build', async () => {
    expect(await isNewBuild('a', fetcher({ ok: true, json: async () => ({ build: 'a' }) }))).toBe(false)
  })

  it('is false when version.json is missing, malformed or unreachable', async () => {
    expect(await isNewBuild('a', fetcher({ ok: false }))).toBe(false)
    expect(await isNewBuild('a', fetcher({ ok: true, json: async () => ({}) }))).toBe(false)
    expect(await isNewBuild('a', fetcher(new TypeError('Failed to fetch')))).toBe(false)
  })
})

describe('watchForUpdates', () => {
  function setup(build: string) {
    const listeners: Record<string, () => void> = {}
    const storage = new Map<string, string>()
    const assign = vi.fn()
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ build }) })))
    vi.stubGlobal('window', { addEventListener: (type: string, fn: () => void) => (listeners[type] = fn), location: { assign, reload: vi.fn() } })
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: (type: string, fn: () => void) => (listeners[type] = fn) })
    vi.stubGlobal('sessionStorage', { getItem: (k: string) => storage.get(k) ?? null, setItem: (k: string, v: string) => storage.set(k, v) })
    let beforeEach!: (to: RouteLocationNormalized, from: RouteLocationNormalized) => unknown
    let onError!: (error: unknown, to: RouteLocationNormalized) => void
    const router = { beforeEach: (fn: typeof beforeEach) => (beforeEach = fn), onError: (fn: typeof onError) => (onError = fn) } as unknown as Router
    watchForUpdates(router, 'current')
    const route = (fullPath: string, matched = 1) => ({ fullPath, matched: Array.from({ length: matched }) }) as unknown as RouteLocationNormalized
    return { listeners, assign, route, navigate: (to: string) => beforeEach(route(to), route('/')), fail: (error: unknown, to: string) => onError(error, route(to)) }
  }

  beforeEach(() => {
    vi.useFakeTimers()
    toast.mockReset()
  })
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps SPA navigation while the deployed build matches', async () => {
    const { listeners, navigate, assign } = setup('current')
    await listeners.visibilitychange!()
    expect(navigate('/runs')).toBeUndefined()
    expect(assign).not.toHaveBeenCalled()
    expect(toast).not.toHaveBeenCalled()
  })

  it('turns the next navigation into a full load once a new build is deployed', async () => {
    const { listeners, navigate, assign } = setup('next')
    listeners.visibilitychange!()
    await vi.waitFor(() => expect(toast).toHaveBeenCalledOnce())
    expect(navigate('/runs')).toBe(false)
    expect(assign).toHaveBeenCalledWith('/runs')
  })

  it('polls for a new build on an interval', async () => {
    setup('next')
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    expect(toast).toHaveBeenCalledOnce()
  })

  it('loads the target page when its chunk is gone, but not in a loop', () => {
    const { fail, assign } = setup('current')
    const gone = new TypeError('Failed to fetch dynamically imported module: /assets/RunPage-abc.js')
    fail(gone, '/runs')
    fail(gone, '/runs')
    expect(assign).toHaveBeenCalledOnce()
    expect(assign).toHaveBeenCalledWith('/runs')
    fail(new Error('boom'), '/other')
    expect(assign).toHaveBeenCalledOnce()
  })
})
