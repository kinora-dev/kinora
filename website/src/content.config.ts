import { glob } from 'astro/loaders'
import { z } from 'astro/zod'
import { defineCollection } from 'astro:content'

const blogAuthor = z.object({
  name: z.string(),
  url: z.string().url().optional(),
})

const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    date: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    tags: z.array(z.string()).default([]),
    draft: z.boolean().default(false),
    slug: z.string(),
    canonicalUrl: z.string().optional(),
    image: z.string().default('/og-image.png'),
    imageAlt: z.string().optional(),
    cover: z.enum(['overview', 'test-history', 'trace-viewer', 'tests', 'project', 'compare', 'desktop']).default('overview'),
    author: blogAuthor.default({
      name: 'Joris Gallot',
      url: 'https://jorisgallot.dev',
    }),
  }),
})

export const collections = { blog }
