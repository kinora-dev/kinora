export function formatMs(ms: number | undefined): string {
  if (ms === undefined || !Number.isFinite(ms))
    return ''
  // Round first so a value just below a unit boundary moves to the next unit ("1.0s", not "1000ms").
  if (Math.round(ms) < 1000)
    return `${Math.round(ms)}ms`
  if (Math.round(ms / 100) < 600)
    return `${(ms / 1000).toFixed(1)}s`
  const total = Math.round(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}m${s.toString().padStart(2, '0')}s`
}
