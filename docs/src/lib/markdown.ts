import type { CollectionEntry } from 'astro:content'
import { SITE } from './site'

export function slugOf(entry: CollectionEntry<'docs'>): string {
  return entry.id === 'index' ? '' : entry.id.replace(/\/index$/, '')
}

export function markdownHrefFor(slug: string): string {
  return slug ? `/${slug}.md` : '/index.md'
}

export function pageMarkdown(entry: CollectionEntry<'docs'>): string {
  const slug = slugOf(entry)
  const url = `${SITE.url}${slug ? `/${slug}/` : '/'}`
  const desc = entry.data.description ? `\n\n${entry.data.description}` : ''
  return `# ${entry.data.title}\n${url}${desc}\n\n${(entry.body ?? '').trim()}`
}
