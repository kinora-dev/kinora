import { env } from '@/lib/env'

interface AttachmentLike {
  name: string
  contentType: string
  url?: string
}

export function isTraceAttachment(a: AttachmentLike): boolean {
  return a.name === 'trace' || a.contentType === 'application/zip'
}

// Link to open a test's trace in the bundled trace viewer, or undefined if the
// test has no hosted trace. The server returns an absolute artifact URL.
export function traceViewerHref(attachments: AttachmentLike[], tab?: 'attachments'): string | undefined {
  const trace = attachments.find(a => a.url && isTraceAttachment(a))
  return trace?.url ? traceViewerUrl(trace.url, tab) : undefined
}

export function traceViewerUrl(traceUrl: string, tab?: 'attachments'): string {
  const viewer = env.viewerBaseUrl.endsWith('/') ? env.viewerBaseUrl : `${env.viewerBaseUrl}/`
  const href = `${viewer}?trace=${encodeURIComponent(traceUrl)}`
  return tab ? `${href}&tab=${tab}` : href
}
