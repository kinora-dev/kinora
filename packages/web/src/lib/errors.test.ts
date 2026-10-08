import { TRPCClientError } from '@trpc/client'
import { describe, expect, it } from 'vitest'
import { describeError } from './errors'

function trpcError(message: string, code?: string): TRPCClientError<never> {
  const result = code ? { result: { error: { message, code: -32000, data: { code } } } } : undefined
  return new TRPCClientError(message, result as never)
}

describe('describeError', () => {
  it('reads a tRPC error without a server payload as a network failure', () => {
    expect(describeError(trpcError('Failed to fetch'))).toEqual({
      kind: 'network',
      title: 'Can\'t reach the kinora server.',
      detail: 'Failed to fetch',
      retryable: true,
    })
  })

  it('treats missing and forbidden alike, and not worth retrying', () => {
    for (const code of ['NOT_FOUND', 'FORBIDDEN']) {
      expect(describeError(trpcError('Project not found', code))).toMatchObject({
        kind: 'not-found',
        detail: 'Project not found',
        retryable: false,
      })
    }
  })

  it('falls back to a generic title for other server errors', () => {
    expect(describeError(trpcError('boom', 'INTERNAL_SERVER_ERROR'))).toMatchObject({ kind: 'unknown', detail: 'boom', retryable: true })
  })

  it('handles non-tRPC errors and non-errors', () => {
    expect(describeError(new Error('nope'))).toMatchObject({ kind: 'unknown', detail: 'nope' })
    expect(describeError('plain')).toMatchObject({ kind: 'unknown', detail: 'plain' })
  })
})
