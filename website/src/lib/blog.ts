import type { CollectionEntry } from 'astro:content'
import { getCollection } from 'astro:content'

export type BlogPost = CollectionEntry<'blog'>

export async function getPublishedBlogPosts(): Promise<BlogPost[]> {
  const posts = await getCollection('blog', ({ data }) => !data.draft)
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime())
}

export function formatBlogDate(date: Date): string {
  return new Intl.DateTimeFormat('en', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

export function blogPath(post: BlogPost): string {
  return `/blog/${post.data.slug}`
}

export function blogCanonicalUrl(post: BlogPost, site: URL): string {
  return new URL(post.data.canonicalUrl ?? blogPath(post), site).toString()
}

export function blogImageUrl(post: BlogPost, site: URL): string {
  return new URL(post.data.image, site).toString()
}

export function blogImageAlt(post: BlogPost): string {
  return post.data.imageAlt ?? `${post.data.title} - kinora blog`
}
