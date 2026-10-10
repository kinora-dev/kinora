// What the demo apps' fake backend (fixtures.ts) serves.
export const ORDERS: Record<string, unknown> = {
  ord_1042: {
    id: 'ord_1042',
    amount: 129,
    status: 'paid',
    plan: 'Kinora Team, annual',
    method: 'Visa •••• 4242',
    created: 'Oct 8, 09:41',
    customer: { name: 'Alex Morgan', email: 'alex@example.com' },
    items: [{ name: 'Kinora Team (annual)', qty: 1, amount: 129 }],
    events: [
      { text: 'Payment authorized', kind: 'ok', at: 'Oct 8, 09:41' },
      { text: 'Payment captured', kind: 'ok', at: 'Oct 8, 09:41' },
      { text: 'Receipt emailed to alex@example.com', kind: '', at: 'Oct 8, 09:42' },
    ],
  },
  ord_1043: {
    id: 'ord_1043',
    amount: 348,
    status: 'authorized',
    plan: 'Kinora Business, annual',
    method: 'Mastercard •••• 5100',
    created: 'Oct 9, 14:03',
    customer: { name: 'Priya Shah', email: 'priya@example.com' },
    items: [{ name: 'Kinora Business (annual)', qty: 1, amount: 299 }, { name: 'Extra seats', qty: 7, amount: 49 }],
    events: [
      { text: 'Payment authorized', kind: 'ok', at: 'Oct 9, 14:03' },
      { text: '3-D Secure check passed', kind: '', at: 'Oct 9, 14:03' },
    ],
  },
}

export const ROUTES: Record<string, unknown> = {
  'orders-api': {
    name: 'orders-api',
    health: 'degraded',
    match: 'GET /v1/orders/*',
    upstream: 'orders.internal:8080',
    retries: { attempts: 3, backoffMs: 200 },
    timeout: '10 s',
    streaming: false,
    samplePath: '/v1/orders',
    recent: [
      { at: '10:41:52', path: '/v1/orders/41', status: 200, ms: 84 },
      { at: '10:41:37', path: '/v1/orders/40', status: 503, ms: 1204 },
      { at: '10:41:09', path: '/v1/orders/39', status: 200, ms: 391 },
      { at: '10:40:44', path: '/v1/orders/38', status: 200, ms: 77 },
    ],
  },
  'exports-api': {
    name: 'exports-api',
    health: 'healthy',
    match: 'GET /v1/exports/*',
    upstream: 'exports.internal:9000',
    retries: { attempts: 2, backoffMs: 500 },
    timeout: '120 s',
    streaming: true,
    samplePath: '/v1/exports/orders.ndjson',
    recent: [
      { at: '10:38:12', path: '/v1/exports/orders.ndjson', status: 200, ms: 2140 },
      { at: '10:21:40', path: '/v1/exports/refunds.ndjson', status: 200, ms: 860 },
      { at: '10:02:05', path: '/v1/exports/orders.ndjson', status: 200, ms: 2311 },
    ],
  },
}

export const ME = {
  name: 'Alex Morgan',
  role: 'Product designer · Lisbon',
  bio: 'Designing the checkout and onboarding flows. Ask me about empty states.',
  stats: { posts: 128, followers: '2.4k', following: 312 },
}

const AUTHORS = ['Priya Shah', 'Marcus Lee', 'Sofia Rossi', 'Kenji Watanabe', 'Amara Okafor']
const UPDATES = [
  'Shipped the new onboarding checklist to 10% of workspaces. Early numbers look good.',
  'Design review for the billing page moved to Thursday, 2pm. Bring your questions.',
  'Heads up: the staging database restarts tonight at 11pm for the Postgres upgrade.',
  'We crossed 1,000 teams on the Pro plan this morning. Thank you all!',
  'Retro notes from the mobile sprint are in the shared folder.',
  'Pairing on the flaky checkout test after lunch if anyone wants to join.',
  'New illustrations for the empty states just landed in Figma.',
  'Customer call recap: they want CSV exports scheduled weekly.',
  'The iOS build is in review. Android rolls out to 50% tomorrow.',
  'Reminder: quarterly planning doc closes for comments on Friday.',
]
export const POSTS = Array.from({ length: 20 }, (_, i) => ({
  id: `post_${i + 1}`,
  author: AUTHORS[i % AUTHORS.length],
  ago: i < 6 ? `${(i + 1) * 7}m` : `${i - 4}h`,
  text: UPDATES[(i * 3) % UPDATES.length],
  likes: (i * 7) % 23 + 2,
  replies: (i * 5) % 9,
}))
