import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { db } from '../db'
import { user } from '../db/schemas/index'
import { verifyUnsubscribe } from './emails'

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:32rem;margin:4rem auto;padding:0 1rem;line-height:1.5"><h1 style="font-size:1.25rem">${title}</h1>${body}</body></html>`
}

// Signed link from the onboarding emails. GET only shows a confirm button, since mail scanners prefetch
// links; POST unsubscribes, which also serves RFC 8058 one-click from the List-Unsubscribe header.
export const emailUnsubscribe = new Hono()
  .get('/unsubscribe', (c) => {
    const u = c.req.query('u')
    const sig = c.req.query('sig')
    if (!verifyUnsubscribe(u, sig))
      return c.html(page('Invalid link', '<p>This unsubscribe link is invalid.</p>'), 400)
    const action = `?u=${encodeURIComponent(u)}&amp;sig=${encodeURIComponent(sig ?? '')}`
    return c.html(page('Stop kinora setup emails', `<p>You will no longer receive emails about setting up your kinora account.</p><form method="post" action="${action}"><button type="submit">Unsubscribe</button></form>`))
  })
  .post('/unsubscribe', async (c) => {
    const u = c.req.query('u')
    if (!verifyUnsubscribe(u, c.req.query('sig')))
      return c.html(page('Invalid link', '<p>This unsubscribe link is invalid.</p>'), 400)
    await db.update(user).set({ onboardingEmailsEnabled: false }).where(eq(user.id, u))
    return c.html(page('Unsubscribed', '<p>You will no longer receive kinora setup emails.</p>'))
  })
