import type { ActionEntry } from '@isomorphic/trace/entries'
import type { ResourceEntry } from '@isomorphic/trace/traceModel'

export type ResourceCategory = 'Fetch' | 'HTML' | 'JS' | 'CSS' | 'Font' | 'Image' | 'Other'

export const RESOURCE_CATEGORIES: ResourceCategory[] = ['Fetch', 'HTML', 'JS', 'CSS', 'Font', 'Image']

export interface NetworkRow {
  id: string
  name: string
  url: string
  method: string
  status: number
  category: ResourceCategory
  size: number
  duration: number
  resource: ResourceEntry
}

export function resourceCategory(resource: ResourceEntry): ResourceCategory {
  const type = resource._resourceType?.toLowerCase()
  const mime = resource.response?.content?.mimeType?.toLowerCase() ?? ''
  if (type === 'document' || mime.includes('html'))
    return 'HTML'
  if (type === 'stylesheet' || mime.includes('css'))
    return 'CSS'
  if (type === 'script' || mime.includes('javascript') || mime.includes('ecmascript'))
    return 'JS'
  if (type === 'font' || mime.startsWith('font/'))
    return 'Font'
  if (type === 'image' || mime.startsWith('image/'))
    return 'Image'
  if (type === 'fetch' || type === 'xhr')
    return 'Fetch'
  return 'Other'
}

// content.size can be 0 even with a body (e.g. vite dev server), so treat 0 as
// missing and fall back to transfer size, then the Content-Length header.
function responseSize(r: ResourceEntry): number {
  const candidates = [
    r.response?.content?.size,
    r.response?._transferSize,
    Number(r.response?.headers?.find(h => h.name.toLowerCase() === 'content-length')?.value),
  ]
  for (const n of candidates) {
    if (typeof n === 'number' && Number.isFinite(n) && n > 0)
      return n
  }
  return 0
}

function resourceName(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    return last || u.hostname
  }
  catch {
    return url
  }
}

function toNetworkRow(r: ResourceEntry): NetworkRow {
  return {
    id: r.id,
    name: resourceName(r.request.url),
    url: r.request.url,
    method: r.request.method,
    status: r.response?.status ?? 0,
    category: resourceCategory(r),
    size: responseSize(r),
    duration: r.time ?? 0,
    resource: r,
  }
}

// Network requests up to (and including) the selected action. Cumulative rather
// than windowed: async sub-resources often resolve between actions, so a strict
// per-action window would usually be empty.
export function resourcesForAction(
  resources: ResourceEntry[],
  action: ActionEntry | undefined,
): NetworkRow[] {
  if (!action)
    return []
  const end = action.endTime || action.startTime
  return resources.filter(r => r._monotonicTime !== undefined && r._monotonicTime <= end).map(toNetworkRow)
}

// Network requests whose start falls inside a brushed time window.
export function resourcesInWindow(
  resources: ResourceEntry[],
  range: { start: number, end: number },
): NetworkRow[] {
  return resources
    .filter(r => r._monotonicTime !== undefined && r._monotonicTime >= range.start && r._monotonicTime <= range.end)
    .map(toNetworkRow)
}

export function formatSize(bytes: number): string {
  if (!bytes || bytes < 0)
    return '-'
  if (bytes < 1024)
    return `${bytes} B`
  if (bytes < 1024 * 1024)
    return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export function statusClass(status: number): string {
  if (!status)
    return 'text-muted-foreground'
  if (status >= 500 || status >= 400)
    return 'text-fail'
  if (status >= 300)
    return 'text-flaky'
  return 'text-pass'
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`
}

export function toCurl(r: ResourceEntry): string {
  const parts = [`curl ${shellQuote(r.request.url)}`]
  if (r.request.method && r.request.method !== 'GET')
    parts.push(`-X ${r.request.method}`)
  for (const h of r.request.headers ?? [])
    parts.push(`-H ${shellQuote(`${h.name}: ${h.value}`)}`)
  if (r.request.postData?.text)
    parts.push(`--data-raw ${shellQuote(r.request.postData.text)}`)
  return parts.join(' \\\n  ')
}

export function toFetch(r: ResourceEntry): string {
  const headers: Record<string, string> = {}
  for (const h of r.request.headers ?? [])
    headers[h.name] = h.value
  const init: Record<string, unknown> = { method: r.request.method, headers }
  if (r.request.postData?.text)
    init.body = r.request.postData.text
  return `fetch(${JSON.stringify(r.request.url)}, ${JSON.stringify(init, null, 2)})`
}

// URL to fetch a response/post body blob stored in the trace.
export function bodyUrl(model: { createRelativeUrl: (p: string) => string } | null, file: string | undefined): string | undefined {
  if (!file || !model)
    return undefined
  return model.createRelativeUrl(`file/${file}`)
}

// null when not JSON or unparseable, so callers fall back to the raw text.
export function prettyJson(text: string, mime: string): string | null {
  if (!mime.includes('json') && !/^\s*[[{]/.test(text))
    return null
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  }
  catch {
    return null
  }
}
