import type { ActionEntry } from '@isomorphic/trace/entries'
import type { ResourceEntry } from '@isomorphic/trace/traceModel'

export type ResourceCategory = 'Fetch' | 'HTML' | 'JS' | 'CSS' | 'Font' | 'Image' | 'Other'

export const RESOURCE_CATEGORIES: ResourceCategory[] = ['Fetch', 'HTML', 'JS', 'CSS', 'Font', 'Image']

export type RouteOutcome = 'fulfilled' | 'continued' | 'aborted'

export interface NetworkRow {
  id: string
  name: string
  url: string
  method: string
  status: number
  category: ResourceCategory
  size: number
  duration: number
  route?: RouteOutcome
  resource: ResourceEntry
}

export function routeOutcome(r: ResourceEntry): RouteOutcome | undefined {
  if (r._wasFulfilled)
    return 'fulfilled'
  if (r._wasAborted)
    return 'aborted'
  if (r._wasContinued)
    return 'continued'
  return undefined
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
    route: routeOutcome(r),
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

export function allResources(resources: ResourceEntry[]): NetworkRow[] {
  return resources.map(toNetworkRow)
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

export function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript') || mime.includes('form-urlencoded') || mime.includes('graphql')
}

export type NetworkMatch = 'url' | 'headers' | 'request body' | 'response body'

export const NETWORK_SEARCH_FIELDS: { field: NetworkMatch, label: string }[] = [
  { field: 'url', label: 'URL' },
  { field: 'headers', label: 'Headers' },
  { field: 'request body', label: 'Request body' },
  { field: 'response body', label: 'Response body' },
]

export const SEARCH_BODY_LIMIT = 200_000

function headersText(headers: { name: string, value: string }[] | undefined): string {
  return (headers ?? []).map(h => `${h.name}: ${h.value}`).join('\n')
}

export function networkMatches(row: NetworkRow, query: string, responseText?: string, requestText?: string): NetworkMatch[] {
  if (!query)
    return []
  const r = row.resource
  const out: NetworkMatch[] = []
  if (row.url.toLowerCase().includes(query))
    out.push('url')
  if (`${headersText(r.request.headers)}\n${headersText(r.response?.headers)}`.toLowerCase().includes(query))
    out.push('headers')
  if ((requestText ?? (r.request.postData?.text ?? '').slice(0, SEARCH_BODY_LIMIT).toLowerCase()).includes(query))
    out.push('request body')
  if (responseText?.includes(query))
    out.push('response body')
  return out
}

export function searchableResponseFile(r: ResourceEntry): string | undefined {
  const content = r.response?.content
  return content?._file && isTextMime(content.mimeType?.toLowerCase() ?? '') ? content._file : undefined
}

export function searchableRequestFile(r: ResourceEntry): string | undefined {
  const postData = r.request.postData
  const mime = (postData?.mimeType ?? r.request.headers?.find(h => h.name.toLowerCase() === 'content-type')?.value ?? '').toLowerCase()
  return postData?._file && !postData.text && isTextMime(mime) ? postData._file : undefined
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
