export interface NavItem {
  label: string
  slug: string
}

export interface NavGroup {
  label?: string
  items: NavItem[]
}

// Single source of truth: sidebar order, active state, and prev/next all derive from this.
export const NAV: NavGroup[] = [
  {
    items: [
      { label: 'Introduction', slug: '' },
      { label: 'Getting started', slug: 'getting-started' },
    ],
  },
  {
    label: 'Guides',
    items: [
      { label: 'Playwright reporter', slug: 'guides/reporter' },
      { label: 'CLI upload', slug: 'guides/cli' },
      { label: 'PR comments', slug: 'guides/pr-comments' },
      { label: 'Component testing', slug: 'guides/component-testing' },
      { label: 'Alerts', slug: 'guides/alerts' },
      { label: 'MCP for coding agents', slug: 'guides/mcp' },
      { label: 'Desktop app', slug: 'guides/desktop' },
    ],
  },
  {
    label: 'Self-hosting',
    items: [
      { label: 'Overview', slug: 'self-hosting' },
      { label: 'Configuration', slug: 'self-hosting/configuration' },
      { label: 'Storage & artifacts', slug: 'self-hosting/storage' },
      { label: 'Upgrading & backups', slug: 'self-hosting/upgrading' },
    ],
  },
  {
    label: 'Reference',
    items: [
      { label: 'Environment variables', slug: 'reference/environment' },
      { label: 'REST API', slug: 'reference/api' },
    ],
  },
]

export function hrefFor(slug: string): string {
  return slug ? `/${slug}/` : '/'
}

const FLAT = NAV.flatMap(g => g.items)

export function neighbors(slug: string): { prev?: NavItem, next?: NavItem } {
  const i = FLAT.findIndex(x => x.slug === slug)
  if (i === -1)
    return {}
  return {
    prev: i > 0 ? FLAT[i - 1] : undefined,
    next: i < FLAT.length - 1 ? FLAT[i + 1] : undefined,
  }
}
