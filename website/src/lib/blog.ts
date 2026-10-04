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
