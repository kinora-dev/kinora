import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import { hrefFor, NAV } from '../lib/nav'
import { SITE } from '../lib/site'

export const GET: APIRoute = async () => {
  const url = SITE.url
  const entries = await getCollection('docs')

  const bySlug = new Map()
  for (const e of entries) {
    const slug = e.id === 'index' ? '' : e.id.replace(/\/index$/, '')
    bySlug.set(slug, e)
  }

  const pages = NAV.flatMap(g => g.items)
    .map((item) => {
      const e = bySlug.get(item.slug)
      if (!e)
        return null
      const desc = e.data.description ? `\n\n${e.data.description}` : ''
      return `# ${e.data.title}\n${url}${hrefFor(item.slug)}${desc}\n\n${(e.body ?? '').trim()}`
    })
    .filter(Boolean)
    .join('\n\n---\n\n')

  const body = `# kinora docs - full content

> Documentation for kinora, the dashboard for browser test reports (Playwright, Vitest browser mode, Storybook) across projects and over time, with an embedded trace viewer. CI runs push their results to kinora; it tracks pass rates, trends, and flaky tests, and opens the full Playwright trace inline for any failure. Every documentation page is concatenated below in one file.

${pages}
`

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
