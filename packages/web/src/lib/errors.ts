import { TRPCClientError } from '@trpc/client'

export type ErrorKind = 'network' | 'not-found' | 'unknown'

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
  'not-found': 'This page doesn\'t exist or you don\'t have access to it.',
  'unknown': 'Something went wrong while loading this page.',
}

// Missing and forbidden read the same on purpose: the server doesn't reveal which one it is.
const NOT_FOUND_CODES = new Set(['NOT_FOUND', 'FORBIDDEN'])

function kindOf(error: unknown): ErrorKind {
  if (!(error instanceof TRPCClientError))
    return 'unknown'
  const code = (error.data as { code?: string } | null | undefined)?.code
  // No error payload means no tRPC response at all: server down, wrong URL, CORS, offline.
  if (!code)
    return 'network'
  return NOT_FOUND_CODES.has(code) ? 'not-found' : 'unknown'
}

// Turn a failed page query into something to show: a readable title plus the raw detail.
export function describeError(error: unknown): ErrorInfo {
  const kind = kindOf(error)
  const detail = error instanceof Error ? error.message : String(error)
  return { kind, title: TITLES[kind], detail, retryable: kind !== 'not-found' }
}
