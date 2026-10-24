import type { ErrorDescription } from '../src/core/isomorphic/trace/traceModel'
import { describe, expect, it } from 'vitest'
import { errorLocation, uniqueErrors } from '../src/ui/lib/errors'

describe('uniqueErrors', () => {
  it('keeps one error per message', () => {
    const errorDescriptors: ErrorDescription[] = [{ message: 'a' }, { message: 'b' }, { message: 'a' }]
    expect(uniqueErrors({ errorDescriptors }).map(e => e.message)).toEqual(['a', 'b'])
  })
})

describe('errorLocation', () => {
  it('points at the first stack frame, short and full', () => {
    expect(errorLocation({ message: 'x', stack: [{ file: '/repo/tests/demo.spec.ts', line: 6, column: 3 }] }))
      .toEqual({ short: 'demo.spec.ts:6', full: '/repo/tests/demo.spec.ts:6' })
    expect(errorLocation({ message: 'x' })).toBeUndefined()
  })
})
