import { describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { useOverview } from '@/composables/queries'

const { overviewQuery } = vi.hoisted(() => ({ overviewQuery: vi.fn() }))
vi.mock('@/lib/trpc', () => ({ trpc: { dashboard: { overview: { query: overviewQuery } } } }))
vi.mock('@/lib/errors', () => ({ reportQueryError: vi.fn() }))

describe('useOverview', () => {
  it('refetches with the new filters and keeps the current state meanwhile', async () => {
    overviewQuery.mockResolvedValueOnce({ generatedAt: 'first' }).mockReturnValueOnce(new Promise(() => {}))
    const branch = ref<string | undefined>()
    const query = useOverview(branch, () => undefined)
    await vi.waitFor(() => expect(query.state.value).toEqual({ generatedAt: 'first' }))

    branch.value = 'main'
    await nextTick()

    expect(overviewQuery).toHaveBeenNthCalledWith(2, { branch: 'main', tag: undefined })
    expect(query.state.value).toEqual({ generatedAt: 'first' })
  })
})
