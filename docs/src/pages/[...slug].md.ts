import type { APIRoute, GetStaticPaths } from 'astro'
import { getCollection } from 'astro:content'
import { pageMarkdown, slugOf } from '../lib/markdown'

export const getStaticPaths: GetStaticPaths = async () => {
  const entries = await getCollection('docs')
  return entries.map(entry => ({ params: { slug: slugOf(entry) || 'index' }, props: { entry } }))
}

export const GET: APIRoute = ({ props }) => {
  return new Response(`${pageMarkdown(props.entry)}\n`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  })
}
