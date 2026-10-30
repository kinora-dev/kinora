import type { NormTest, RunIncident } from '../contracts/kinora'
import { stripAnsi } from './ansi'

// A run with fewer failures is never flagged: too little to tell an outage from a regression.
export const INCIDENT_MIN_FAILED = 3
// Share of the executed tests that must fail.
export const INCIDENT_FAIL_RATIO = 0.8
// Share of the failures that must share the environment cause.
export const INCIDENT_CAUSE_RATIO = 0.7

type NetworkCause = 'connection refused' | 'name not resolved' | 'connection reset' | 'unreachable' | 'timed out'

// Chromium, Firefox, WebKit and Node (request fixture) wordings of a host that never answered.
const NETWORK_ERRORS: [RegExp, NetworkCause][] = [
  [/net::ERR_CONNECTION_REFUSED|NS_ERROR_CONNECTION_REFUSED|\bECONNREFUSED\b|Could not connect to (?:the )?server|Connection refused/i, 'connection refused'],
  [/net::ERR_NAME_NOT_RESOLVED|NS_ERROR_UNKNOWN_HOST|\bENOTFOUND\b|\bEAI_AGAIN\b|server with the specified hostname could not be found/i, 'name not resolved'],
  [/net::ERR_CONNECTION_(?:RESET|CLOSED)|net::ERR_EMPTY_RESPONSE|NS_ERROR_NET_RESET|\bECONNRESET\b|socket hang up/i, 'connection reset'],
  [/net::ERR_(?:CONNECTION_TIMED_OUT|TIMED_OUT|ADDRESS_UNREACHABLE|INTERNET_DISCONNECTED)|NS_ERROR_NET_TIMEOUT|\bETIMEDOUT\b|\bEHOSTUNREACH\b/i, 'unreachable'],
  [/page\.goto: (?:Test )?timeout/i, 'timed out'],
]

const BROWSER_CRASH = /Target crashed|Page crashed|browser has disconnected|Browser closed|browserType\.launch:/i
// Also what every pending call reports once a test times out, so it only counts without a timeout.
const BROWSER_CLOSED = /Target page, context or browser has been closed|Browser has been closed/i
const TEST_TIMEOUT = /^(?:Error: )?Test timeout of \d+ms exceeded/

const URL_RE = /https?:\/\/[^\s"'`<>)]+/gi
const SOCKET_RE = /\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|EHOSTUNREACH)\s+(\S+):(\d+)\b/g
const DNS_RE = /\b(?:ENOTFOUND|EAI_AGAIN)\s+([\w.-]+)/g

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])

// A host as errors name it. No port: a DNS failure, which matches the host on any port.
interface Endpoint {
  hostname: string
  port?: string
}

function hostnameOf(raw: string): string {
  const h = raw.toLowerCase()
  return LOOPBACK.has(h) ? 'localhost' : h
}

function endpointOfUrl(raw: string): (Endpoint & { label: string }) | undefined {
  try {
    const url = new URL(raw)
    return { hostname: hostnameOf(url.hostname), port: url.port || (url.protocol === 'https:' ? '443' : '80'), label: url.host }
  }
  catch {
    return undefined
  }
}

function addressesIn(text: string): Endpoint[] {
  const found: Endpoint[] = []
  for (const m of text.matchAll(URL_RE)) {
    const e = endpointOfUrl(m[0])
    if (e)
      found.push(e)
  }
  for (const m of text.matchAll(SOCKET_RE))
    found.push({ hostname: hostnameOf(m[1]), port: m[2] })
  for (const m of text.matchAll(DNS_RE))
    found.push({ hostname: hostnameOf(m[1]) })
  return found
}

function sameHost(a: Endpoint, b: Endpoint): boolean {
  return a.hostname === b.hostname && (!a.port || !b.port || a.port === b.port)
}

interface NetworkFailure {
  cause: NetworkCause
  addresses: Endpoint[]
}

function networkFailure(texts: string[]): NetworkFailure | undefined {
  for (const text of texts) {
    const cause = NETWORK_ERRORS.find(([re]) => re.test(text))?.[1]
    if (cause)
      return { cause, addresses: addressesIn(text) }
  }
  return undefined
}

function browserCrashed(texts: string[]): boolean {
  if (texts.some(t => BROWSER_CRASH.test(t)))
    return true
  return !texts.some(t => TEST_TIMEOUT.test(t)) && texts.some(t => BROWSER_CLOSED.test(t))
}

function mostCommon<T>(items: T[], key: (item: T) => string): T | undefined {
  const counts = new Map<string, { item: T, n: number }>()
  for (const item of items) {
    const k = key(item)
    const entry = counts.get(k) ?? { item, n: 0 }
    entry.n++
    counts.set(k, entry)
  }
  return [...counts.values()].sort((a, b) => b.n - a.n)[0]?.item
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`

// Judge a finished run: an environment incident when nearly every executed test failed and most
// failures could not reach the app's host (the host of a `baseURL`, else the one most failures
// named) or saw the browser crash. A third-party host down or a failing assertion never counts.
export function detectIncident(
  tests: Pick<NormTest, 'status' | 'errors'>[],
  baseUrls: string[] = [],
): RunIncident | null {
  const executed = tests.filter(t => t.status !== 'skipped').length
  const failing = tests.filter(t => t.status === 'unexpected')
  if (failing.length < INCIDENT_MIN_FAILED || failing.length < executed * INCIDENT_FAIL_RATIO)
    return null

  const enough = (hits: number) => hits >= failing.length * INCIDENT_CAUSE_RATIO
  const head = `${failing.length} of ${plural(executed, 'test')} failed`
  const errors = failing.map(t => t.errors.map(e => stripAnsi(e.message)))

  const network = errors.map(networkFailure).filter(f => !!f)
  let apps = baseUrls.map(endpointOfUrl).filter(e => !!e)
  if (!apps.length) {
    const dominant = mostCommon(network.flatMap(f => f.addresses), e => e.hostname)
    apps = dominant ? [{ hostname: dominant.hostname, label: dominant.hostname }] : []
  }
  const hits = network.flatMap((f) => {
    const app = apps.find(a => f.addresses.some(e => sameHost(a, e)))
    return app ? [{ app, cause: f.cause }] : []
  })
  if (hits.length && enough(hits.length)) {
    const host = mostCommon(hits, h => h.app.label)!.app.label
    const cause = mostCommon(hits, h => h.cause)!.cause
    return {
      rule: 'host-unreachable',
      reason: `${head}, ${hits.length} of them navigating or connecting to ${host} (${cause}).`,
      host,
    }
  }

  const crashes = errors.filter(browserCrashed).length
  if (crashes && enough(crashes)) {
    return {
      rule: 'browser-crash',
      reason: `${head}, ${crashes} of them with the browser crashing or closing.`,
    }
  }
  return null
}
