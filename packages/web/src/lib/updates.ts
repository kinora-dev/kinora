import type { Router } from 'vue-router'
import { toast } from 'vue-sonner'

// A deploy replaces the whole static image, so an open tab keeps pointing at hashed chunks that
// no longer exist. Each build stamps its id into the bundle and into /version.json; when they
// differ the next route change becomes a full page load, and a long-idle tab gets a reload toast.

const POLL_MS = 5 * 60 * 1000
// Guard against a reload loop when a chunk keeps failing for another reason (offline, CDN issue).
const RELOAD_KEY = 'kinora:update-reload'
const RELOAD_COOLDOWN_MS = 10_000

// Chrome / Firefox / Safari wording for a failed dynamic import.
const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed/i

export function isChunkLoadError(error: unknown): boolean {
  return error instanceof Error && CHUNK_ERROR.test(error.message)
}

// Network failures and missing files count as "no update": only a readable, different id does.
export async function isNewBuild(currentBuild: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetcher(`${import.meta.env.BASE_URL}version.json`, { cache: 'no-store' })
    if (!res.ok)
      return false
    const { build } = await res.json() as { build?: unknown }
    return typeof build === 'string' && build !== currentBuild
  }
  catch {
    return false
  }
}

function hardNavigate(url: string): boolean {
  const last = Number(sessionStorage.getItem(RELOAD_KEY) ?? 0)
  if (Date.now() - last < RELOAD_COOLDOWN_MS)
    return false
  sessionStorage.setItem(RELOAD_KEY, String(Date.now()))
  window.location.assign(url)
  return true
}

export function watchForUpdates(router: Router, currentBuild: string) {
  let stale = false

  const markStale = () => {
    if (stale)
      return
    stale = true
    toast('A new version of kinora is available', {
      duration: Number.POSITIVE_INFINITY,
      action: { label: 'Reload', onClick: () => window.location.reload() },
    })
  }

  const check = async () => {
    if (!stale && await isNewBuild(currentBuild))
      markStale()
  }

  // Swap the SPA navigation for a full load so the user lands on the new build without noticing.
  router.beforeEach((to, from) => {
    if (stale && from.matched.length && hardNavigate(to.fullPath))
      return false
  })

  // A route chunk from the previous build is gone: load the target page from the new one.
  router.onError((error, to) => {
    if (isChunkLoadError(error)) {
      markStale()
      hardNavigate(to.fullPath)
    }
  })
  // Same failure outside the router (a lazy component, a preloaded CSS file).
  window.addEventListener('vite:preloadError', markStale)

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible')
      void check()
  })
  setInterval(() => {
    if (document.visibilityState === 'visible')
      void check()
  }, POLL_MS)
}
