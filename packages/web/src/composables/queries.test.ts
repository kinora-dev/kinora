import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useOverview } from '@/composables/queries'

const { overviewQuery } = vi.hoisted(() => ({ overviewQuery: vi.fn() }))
vi.mock('@/lib/trpc', () => ({ trpc: { dashboard: { overview: { query: overviewQuery } } } }))
vi.mock('@/lib/errors', () => ({ reportQueryError: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

const settle = () => new Promise(resolve => setTimeout(resolve, 0))

async function startTwoRequests() {
  const first = deferred<{ generatedAt: string }>()
  const second = deferred<{ generatedAt: string }>()
  overviewQuery.mockReset().mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise)
  const branch = ref<string | undefined>()
  const query = useOverview(branch, () => undefined)
  branch.value = 'main'
  await nextTick()
  await settle()
  return { first, second, query }
}

describe('useOverview', () => {
  it('refetches with the new filters', async () => {
    const { query } = await startTwoRequests()
    expect(overviewQuery).toHaveBeenNthCalledWith(2, { branch: 'main', tag: undefined })
    expect(query.state.value).toBeNull()
  })

  it('keeps the newest response when an older one lands last', async () => {
    const { first, second, query } = await startTwoRequests()
    second.resolve({ generatedAt: 'newest' })
    await settle()
    first.resolve({ generatedAt: 'stale' })
    await settle()
    expect(query.state.value).toEqual({ generatedAt: 'newest' })
  })

  it('ignores an error from a request that was already superseded', async () => {
    const { first, second, query } = await startTwoRequests()
    second.resolve({ generatedAt: 'newest' })
    await settle()
    first.reject(new Error('network'))
    await settle()
    expect(query.error.value).toBeUndefined()
    expect(query.state.value).toEqual({ generatedAt: 'newest' })
  })
})
