import { TRPCClientError } from '@trpc/client'

export type ErrorKind = 'network' | 'rate-limited' | 'not-found' | 'unknown'

export interface ErrorInfo {
  kind: ErrorKind
  /** What happened, in plain words. */
  title: string
  /** The underlying message, kept visible for diagnosis (self-hosters debug with it). */
  detail: string
  /** Whether running the same request again can succeed. */
  retryable: boolean
}

const TITLES: Record<ErrorKind, string> = {
  'network': 'Can\'t reach the kinora server.',
  'rate-limited': 'Too many requests. Try again in a moment.',
  'not-found': 'This page doesn\'t exist or you don\'t have access to it.',
  'unknown': 'Something went wrong while loading this page.',
}

// Missing and forbidden read the same on purpose: the server doesn't reveal which one it is.
const NOT_FOUND_CODES = new Set(['NOT_FOUND', 'FORBIDDEN'])

function kindOf(error: unknown): ErrorKind {
  if (!(error instanceof TRPCClientError))
    return 'unknown'
  // The server's rate limiter answers outside tRPC, so there is no error code, only the HTTP status.
  if ((error.meta?.response as { status?: number } | undefined)?.status === 429)
    return 'rate-limited'
  const code = (error.data as { code?: string } | null | undefined)?.code
  // No error payload means no tRPC response at all: server down, wrong URL, CORS, offline.
  if (!code)
    return 'network'
  return NOT_FOUND_CODES.has(code) ? 'not-found' : 'unknown'
}

// Turn a failed page query into something to show: a readable title plus the raw detail.
export function describeError(error: unknown): ErrorInfo {
  const kind = kindOf(error)
  // A 429 isn't a tRPC payload, so the client's own message ("Unable to transform response") misleads.
  const detail = kind === 'rate-limited' ? 'HTTP 429' : error instanceof Error ? error.message : String(error)
  return { kind, title: TITLES[kind], detail, retryable: kind !== 'not-found' }
}

// `onError` for page queries (useAsyncState). VueUse's default is `globalThis.reportError`, which
// raises every failed query as an uncaught window error, on top of the ErrorState the page shows.
// That is noise for failures we expect: an unreachable server (including requests cut short by
// navigating away), rate limiting, and missing or forbidden pages.
export function reportQueryError(error: unknown): void {
  if (describeError(error).kind === 'unknown')
    globalThis.reportError?.(error)
}
