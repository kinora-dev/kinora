import type { APIRoute } from 'astro'
import { getCollection } from 'astro:content'
import { pageMarkdown, slugOf } from '../lib/markdown'
import { NAV } from '../lib/nav'

export const GET: APIRoute = async () => {
  const entries = await getCollection('docs')
  const bySlug = new Map(entries.map(e => [slugOf(e), e]))

  const pages = NAV.flatMap(g => g.items)
    .map(item => bySlug.get(item.slug))
    .filter(e => e !== undefined)
    .map(pageMarkdown)
    .join('\n\n---\n\n')

  const body = `# kinora docs - full content

> Documentation for kinora, the dashboard for browser test reports (Playwright, Vitest browser mode, Storybook) across projects and over time, with an embedded trace viewer. CI runs push their results to kinora; it tracks pass rates, trends, and flaky tests, and opens the full Playwright trace inline for any failure. Every documentation page is concatenated below in one file.

${pages}
`

  return new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
}
