import { expect, test } from '../fixtures'

test.describe('Pagination', () => {
  test('starts on the first page with no way back', async ({ mount }) => {
    const component = await mount('Pagination/Stateful')
    await expect(component.getByRole('button', { name: 'Previous Page' })).toBeDisabled()
    await expect(component.getByRole('button', { name: 'Next Page' })).toBeEnabled()
    await expect(component.getByTestId('page')).toHaveText('1')
  })

  test('moves with next, previous and a page number', async ({ mount }) => {
    const component = await mount('Pagination/Stateful')
    const page = component.getByTestId('page')

    await component.getByRole('button', { name: 'Next Page' }).click()
    await expect(page).toHaveText('2')
    await component.getByRole('button', { name: 'Page 4' }).click()
    await expect(page).toHaveText('4')
    await component.getByRole('button', { name: 'Previous Page' }).click()
    await expect(page).toHaveText('3')
  })

  test('collapses distant pages but keeps both edges', async ({ mount }) => {
    const component = await mount('Pagination/Stateful', { startPage: 5 })
    await expect(component.getByRole('button', { name: 'Page 1', exact: true })).toBeVisible()
    await expect(component.getByRole('button', { name: 'Page 10' })).toBeVisible()
    await expect(component.getByRole('button', { name: 'Page 8' })).toHaveCount(0)
    await expect(component.getByText('More pages')).toHaveCount(2)
  })

  test('stops at the last page', async ({ mount }) => {
    const component = await mount('Pagination/Stateful', { startPage: 10 })
    await expect(component.getByRole('button', { name: 'Next Page' })).toBeDisabled()
  })
})
