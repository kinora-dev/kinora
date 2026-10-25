import type { ActionEntry } from '@isomorphic/trace/entries'
import type { ResourceEntry } from '@isomorphic/trace/traceModel'
import { isJsonMimeType, isXmlMimeType } from '@isomorphic/mimeType'
import { resourceOwnerRef } from '@isomorphic/trace/traceModel'

export type ResourceCategory = 'Fetch' | 'HTML' | 'JS' | 'CSS' | 'Font' | 'Image' | 'WS' | 'Other'

export const RESOURCE_CATEGORIES: ResourceCategory[] = ['Fetch', 'HTML', 'JS', 'CSS', 'Font', 'Image', 'WS']

// `api` marks requests made through APIRequestContext rather than the page.
export type RouteOutcome = 'fulfilled' | 'continued' | 'aborted' | 'api'

// Status Playwright records for a request that never got a response.
export const CANCELED_STATUS = -1

export interface NetworkRow {
  id: string
  name: string
  url: string
  method: string
  status: number
  category: ResourceCategory
  contentType: string
  size: number
  // Undefined while the request was still pending when tracing stopped (HAR `time: -1`).
  duration?: number
  // Relative to the trace start; undefined when the request has no recorded time.
  start?: number
  // The page (page#1, ...) or service worker that issued the request.
  source: string
  route?: RouteOutcome
  resource: ResourceEntry
}

export interface RowContext {
  ownerTitles?: Map<string, string>
  startTime?: number
}

// Same precedence as upstream when a request carries several flags.
export function routeOutcome(r: ResourceEntry): RouteOutcome | undefined {
  if (r._wasAborted)
    return 'aborted'
  if (r._wasContinued)
    return 'continued'
  if (r._wasFulfilled)
    return 'fulfilled'
  if (r._apiRequestRef)
    return 'api'
  return undefined
}

export function resourceCategory(resource: ResourceEntry): ResourceCategory {
  const type = resource._resourceType?.toLowerCase()
  const mime = resource.response?.content?.mimeType?.toLowerCase() ?? ''
  if (type === 'websocket')
    return 'WS'
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
  // API requests (`page.request`) carry no resource type; upstream classifies JSON as Fetch.
  if (type === 'fetch' || type === 'xhr' || mime.startsWith('application/json'))
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

// Last path segment plus the query string, like upstream's Name column.
export function resourceName(url: string): string {
  try {
    const u = new URL(url)
    const last = u.pathname.split('/').filter(Boolean).pop()
    return (last || u.hostname) + u.search
  }
  catch {
    return url
  }
}

export function contentType(r: ResourceEntry): string {
  if (r._resourceType === 'websocket')
    return 'websocket'
  return (r.response?.content?.mimeType ?? '').replace(/;\s*charset=.*$/i, '')
}

function toNetworkRow(r: ResourceEntry, context: RowContext = {}): NetworkRow {
  const owner = resourceOwnerRef(r)
  return {
    id: r.id,
    name: resourceName(r.request.url),
    url: r.request.url,
    method: r.request.method,
    status: r.response?.status ?? 0,
    category: resourceCategory(r),
    contentType: contentType(r),
    size: responseSize(r),
    duration: r.time !== undefined && r.time >= 0 ? r.time : undefined,
    start: r._monotonicTime === undefined ? undefined : r._monotonicTime - (context.startTime ?? 0),
    source: (owner && context.ownerTitles?.get(owner)) || '',
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
  context?: RowContext,
): NetworkRow[] {
  if (!action)
    return []
  const end = action.endTime || action.startTime
  return resources.filter(r => r._monotonicTime !== undefined && r._monotonicTime <= end).map(r => toNetworkRow(r, context))
}

export function allResources(resources: ResourceEntry[], context?: RowContext): NetworkRow[] {
  return resources.map(r => toNetworkRow(r, context))
}

// Network requests whose start falls inside a brushed time window.
export function resourcesInWindow(
  resources: ResourceEntry[],
  range: { start: number, end: number },
  context?: RowContext,
): NetworkRow[] {
  return resources
    .filter(r => r._monotonicTime !== undefined && r._monotonicTime >= range.start && r._monotonicTime <= range.end)
    .map(r => toNetworkRow(r, context))
}

// The network resource a console/page URL most likely refers to: the matching
// request closest at or before the given time, falling back to the first match
// when none of them have a known time (e.g. an aborted request).
export function resourceAtUrl(resources: ResourceEntry[], url: string, atOrBefore: number): ResourceEntry | undefined {
  const matches = resources.filter(r => r.request.url === url)
  const before = matches
    .filter(r => r._monotonicTime !== undefined && r._monotonicTime <= atOrBefore)
    .sort((a, b) => b._monotonicTime! - a._monotonicTime!)
  return before[0] ?? matches[0]
}

export function isTextMime(mime: string): boolean {
  return mime.startsWith('text/') || mime.includes('json') || mime.includes('xml') || mime.includes('javascript') || mime.includes('form-urlencoded') || mime.includes('graphql')
}

// The body as UTF-8 text, or undefined when it looks binary (invalid UTF-8 or NUL bytes).
export function decodeText(buffer: ArrayBuffer): string | undefined {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer)
    return text.includes('\0') ? undefined : text
  }
  catch {
    return undefined
  }
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

export function statusLabel(status: number): string {
  if (status === CANCELED_STATUS)
    return 'canceled'
  return status > 0 ? String(status) : '-'
}

export function statusClass(status: number): string {
  if (status === CANCELED_STATUS)
    return 'text-fail'
  if (!status)
    return 'text-muted-foreground'
  if (status >= 400)
    return 'text-fail'
  if (status >= 300 && status !== 304)
    return 'text-flaky'
  return 'text-pass'
}

// URL to fetch a response/post body blob stored in the trace.
export function bodyUrl(model: { createRelativeUrl: (p: string) => string } | null, file: string | undefined): string | undefined {
  if (!file || !model)
    return undefined
  return model.createRelativeUrl(`file/${file}`)
}

// null when not JSON or unparseable, so callers fall back to the raw text.

// CodeView language for a body of this mime type.
export function bodyLang(mime: string): string {
  const m = mime.toLowerCase()
  if (isJsonMimeType(m) || m.includes('javascript') || m.includes('ecmascript'))
    return 'js'
  if (m.includes('css'))
    return 'css'
  if (m.includes('html'))
    return 'html'
  if (isXmlMimeType(m))
    return 'xml'
  return 'text'
}

const INLINE_TAG = /<[^>]+>[^<]*<\//

export function formatXml(source: string, indent = '  '): string {
  let depth = 0
  const lines: string[] = []
  for (const token of source.replace(/>\s*</g, '>\n<').split('\n')) {
    const trimmed = token.trim()
    if (!trimmed)
      continue
    if (trimmed.startsWith('</'))
      depth = Math.max(depth - 1, 0)
    lines.push(indent.repeat(depth) + trimmed)
    if (trimmed.startsWith('<') && !trimmed.startsWith('</') && !trimmed.endsWith('/>') && !trimmed.startsWith('<?') && !INLINE_TAG.test(trimmed))
      depth++
  }
  return lines.join('\n')
}

// JSON.parse rounds integers beyond MAX_SAFE_INTEGER, so keep each number's source text when the runtime allows it.
function formatJson(source: string): string {
  const rawJSON = (JSON as { rawJSON?: (text: string) => unknown }).rawJSON
  const reviver = rawJSON && ((_key: string, value: unknown, context?: { source?: string }) =>
    typeof value === 'number' && context?.source !== undefined ? rawJSON(context.source) : value)
  return JSON.stringify(JSON.parse(source, reviver as never), null, 2)
}

// Pretty-printed body like upstream's network details; throws when the body does not parse.
export function formatBody(body: string, mime: string): string {
  const m = mime.toLowerCase()
  if (!body.trim() || !m)
    return body
  if (isJsonMimeType(m))
    return formatJson(body)
  if (isXmlMimeType(m))
    return formatXml(body)
  if (m.includes('application/x-www-form-urlencoded'))
    return decodeURIComponent(body.replace(/\+/g, ' '))
  // Kinora extra: JSON served with a generic type (text/plain...) still gets formatted.
  if (/^\s*[[{]/.test(body)) {
    try {
      return formatJson(body)
    }
    catch {}
  }
  return body
}
