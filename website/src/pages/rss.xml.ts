import type { APIRoute } from 'astro'
import { blogCanonicalUrl, getPublishedBlogPosts } from '../lib/blog'
import { SITE } from '../lib/site'

function xml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&apos;')
}

export const GET: APIRoute = async ({ site }) => {
  const base = site ?? new URL(SITE.url)
  const posts = await getPublishedBlogPosts()
  const items = posts.map((post) => {
    const url = blogCanonicalUrl(post, base)
    return `<item>
<title>${xml(post.data.title)}</title>
<link>${xml(url)}</link>
<guid>${xml(url)}</guid>
<description>${xml(post.data.description)}</description>
<pubDate>${post.data.date.toUTCString()}</pubDate>
</item>`
  }).join('\n')

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>kinora blog</title>
<link>${xml(new URL('/blog', base).toString())}</link>
<description>Articles about Playwright reporting, flaky tests, traces, CI debugging, and building Kinora.</description>
<language>en</language>
${items}
</channel>
</rss>`

  return new Response(body, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
