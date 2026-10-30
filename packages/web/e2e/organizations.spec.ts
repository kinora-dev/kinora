import { expect, test } from '@playwright/test'
import { login, TEAMMATE } from './helpers'

const workspaceButton = /workspace/i

test.describe('organizations', () => {
  test('shows the active workspace in the header', async ({ page }) => {
    await login(page)
    await expect(page.getByRole('button', { name: workspaceButton })).toBeVisible()
  })

  test('switching workspace scopes the overview', async ({ page }) => {
    await login(page)
    // demo's own workspace has the full project set
    await expect(page.getByRole('link', { name: 'Web App' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Marketing Site' })).toBeVisible()

    // switch to the workspace demo is only a member of
    await page.getByRole('button', { name: workspaceButton }).click()
    await page.getByRole('menuitem', { name: /Acme QA/i }).click()

    // lands on the overview, now scoped to Acme: only its project shows
    await expect(page).toHaveURL('/')
    await expect(page.getByRole('link', { name: 'API Gateway' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Web App' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Marketing Site' })).toHaveCount(0)
  })

  test('a member gets the read-only team view', async ({ page }) => {
    await login(page)
    await page.getByRole('button', { name: workspaceButton }).click()
    await page.getByRole('menuitem', { name: /Acme QA/i }).click()
    // Switching does a full reload to '/'; wait for it to settle (Acme active) before
    // navigating, else page.goto races the in-flight reload and gets aborted.
    await expect(page.getByRole('button', { name: /Acme QA's workspace/i })).toBeVisible()

    await page.goto('/settings/workspace')
    // demo is a member (not admin) of Acme: no invite form, no token controls
    await expect(page.getByText(/Only admins can invite/i)).toBeVisible()
    await expect(page.getByLabel('Invite by email')).toHaveCount(0)
    await expect(page.locator('#token-name')).toHaveCount(0)
    await expect(page.getByText(/Only admins can create or revoke tokens/i)).toBeVisible()
  })

  test('shows an error for an invalid invitation', async ({ page }) => {
    await login(page)
    await page.goto('/accept-invite/does-not-exist')
    await expect(page.getByText(/Invitation unavailable/i)).toBeVisible()
  })

  test('an unauthenticated invitee is not bounced to login', async ({ page }) => {
    // A logged-out invite link must show the join CTA, not redirect to /login (losing the link).
    await page.goto('/accept-invite/some-invitation-id')
    await expect(page).toHaveURL(/\/accept-invite\//)
    await expect(page.getByText(/You've been invited/i)).toBeVisible()
    await expect(page.getByRole('link', { name: /Create account/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /Sign in/i })).toBeVisible()
  })

  test('a new user signs up through an invite link and joins the workspace', async ({ page }) => {
    // Owner (demo) generates a real invitation and grabs its link.
    await login(page)
    await page.goto('/settings/workspace')
    const email = `invitee-${Date.now()}@test.dev`
    await page.getByLabel('Invite by email').fill(email)
    await page.getByRole('button', { name: 'Invite', exact: true }).click()

    const code = page.locator('code', { hasText: '/accept-invite/' })
    await expect(code).toBeVisible()
    const invitePath = new URL(((await code.textContent()) ?? '').trim()).pathname

    // Sign out, then open the invite as a brand-new (unauthenticated) user.
    await page.locator('button[title="Demo User"]').click()
    await page.getByRole('menuitem', { name: 'Sign out' }).click()
    await expect(page).toHaveURL('/login')

    await page.goto(invitePath)
    await expect(page.getByText(/You've been invited/i)).toBeVisible()
    await page.getByRole('link', { name: /Create account/i }).click()
    await expect(page).toHaveURL(/\/signup\?redirect=/)

    // Sign up with the invited email -> bounced back to the invite -> auto-accepted -> overview.
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').nth(0).fill('password123')
    await page.locator('input[type="password"]').nth(1).fill('password123')
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL('/')

    // Joined: the active workspace is the inviter's, shown in the switcher.
    await expect(page.getByRole('button', { name: /Demo User's workspace/i })).toBeVisible()

    // A new session reopens the last workspace used. Signing back in through the form only
    // (no reload) keeps the SPA state, which is where a stale switcher would surface.
    const relogin = async () => {
      await page.locator(`button[title="${email}"]`).click()
      await page.getByRole('menuitem', { name: 'Sign out' }).click()
      await expect(page).toHaveURL('/login')
      await page.locator('input[type="email"]').fill(email)
      await page.locator('input[type="password"]').fill('password123')
      await page.locator('button[type="submit"]').click()
      await expect(page).toHaveURL('/')
    }
    await relogin()
    await expect(page.getByRole('button', { name: /Demo User's workspace/i })).toBeVisible()

    await page.getByRole('button', { name: workspaceButton }).click()
    await page.getByRole('menuitem', { name: `${email}'s workspace` }).click()
    await expect(page.getByRole('button', { name: `${email}'s workspace` })).toBeVisible()
    await relogin()
    await expect(page.getByRole('button', { name: `${email}'s workspace` })).toBeVisible()
    await expect(page.getByRole('button', { name: /Demo User's workspace/i })).toHaveCount(0)
  })

  test('an owner can rename their workspace', async ({ page }) => {
    // Fresh user owns a workspace; renaming it must reflect in the switcher.
    await page.goto('/signup')
    const email = `rename-${Date.now()}@test.dev`
    await page.locator('input[type="email"]').fill(email)
    await page.locator('input[type="password"]').nth(0).fill('password123')
    await page.locator('input[type="password"]').nth(1).fill('password123')
    await page.locator('button[type="submit"]').click()
    await expect(page).toHaveURL('/')

    await page.goto('/settings/workspace')
    await page.locator('#ws-name').fill('Renamed QA')
    await page.getByRole('button', { name: 'Rename', exact: true }).click()
    await expect(page.getByRole('button', { name: /Renamed QA/i })).toBeVisible()
  })

  test('an owner can invite in their own workspace', async ({ page }) => {
    // teammate owns a single workspace -> owner/admin controls available
    await login(page, TEAMMATE)
    await expect(page.getByRole('button', { name: workspaceButton })).toBeVisible()

    await page.goto('/settings/workspace')
    await expect(page.getByLabel('Invite by email')).toBeVisible()
  })
})
