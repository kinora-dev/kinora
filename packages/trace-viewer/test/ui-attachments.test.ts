import type { Attachment } from '../src/core/isomorphic/trace/traceModel'
import { describe, expect, it } from 'vitest'
import { groupImageDiffs } from '../src/ui/lib/attachments'

function att(name: string, contentType = 'image/png', callId = 'call@1'): Attachment {
  return { name, contentType, file: name, callId }
}

describe('groupImageDiffs', () => {
  it('groups an expected/actual/diff triplet by base name', () => {
    const { diffs, rest } = groupImageDiffs([
      att('snap-expected.png'),
      att('snap-actual.png'),
      att('snap-diff.png'),
    ])
    expect(rest).toHaveLength(0)
    expect(diffs).toHaveLength(1)
    expect(diffs[0]).toMatchObject({ name: 'snap', expected: { name: 'snap-expected.png' }, actual: { name: 'snap-actual.png' }, diff: { name: 'snap-diff.png' } })
  })

  it('accepts a pair without a diff image', () => {
    const { diffs, rest } = groupImageDiffs([att('a-expected.png'), att('a-actual.png')])
    expect(diffs).toHaveLength(1)
    expect(diffs[0].diff).toBeUndefined()
    expect(rest).toHaveLength(0)
  })

  it('leaves incomplete groups (missing actual) in rest', () => {
    const { diffs, rest } = groupImageDiffs([att('a-expected.png'), att('a-diff.png')])
    expect(diffs).toHaveLength(0)
    expect(rest.map(r => r.name)).toEqual(['a-expected.png', 'a-diff.png'])
  })

  it('keeps unrelated attachments in rest', () => {
    const { diffs, rest } = groupImageDiffs([att('trace.zip', 'application/zip'), att('shot.png')])
    expect(diffs).toHaveLength(0)
    expect(rest.map(r => r.name)).toEqual(['trace.zip', 'shot.png'])
  })

  it('groups multiple distinct diffs and preserves order', () => {
    const { diffs } = groupImageDiffs([
      att('one-expected.png'),
      att('two-actual.png'),
      att('one-actual.png'),
      att('two-expected.png'),
    ])
    expect(diffs.map(d => d.name)).toEqual(['one', 'two'])
  })

  it('keeps triplets from different steps apart', () => {
    const { diffs, rest } = groupImageDiffs([
      att('page-expected.png', 'image/png', 'call@1'),
      att('page-actual.png', 'image/png', 'call@1'),
      att('page-expected.png', 'image/png', 'call@2'),
      att('page-actual.png', 'image/png', 'call@2'),
    ])
    expect(rest).toHaveLength(0)
    expect(diffs.map(d => d.expected?.callId)).toEqual(['call@1', 'call@2'])
  })
})
