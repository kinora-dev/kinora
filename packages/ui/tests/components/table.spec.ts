import { expect, test } from '../fixtures'

test.describe('Table', () => {
  test('exposes a captioned table with headers and rows', async ({ mount }) => {
    const component = await mount('Table/Runs')
    const table = component.getByRole('table', { name: 'Latest runs' })
    await expect(table.getByRole('columnheader')).toHaveText(['SHA', 'Health', 'Pass rate'])
    await expect(table.getByRole('row', { name: '1de4783 Failing 85.7%' })).toBeVisible()
    await expect(table.getByRole('row')).toHaveCount(3)
  })

  test('spans its empty state across every column', async ({ mount }) => {
    const component = await mount('Table/Empty')
    const cell = component.getByRole('cell', { name: 'No runs yet.' })
    await expect(cell).toBeVisible()
    await expect(cell).toHaveAttribute('colspan', '3')
  })
})
