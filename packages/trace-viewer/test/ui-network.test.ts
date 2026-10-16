import { describe, expect, it } from 'vitest'
import { allResources, bodyUrl, formatSize, networkMatches, prettyJson, resourceCategory, resourcesForAction, resourcesInWindow, routeOutcome, searchableRequestFile, searchableResponseFile, statusClass, toCurl, toFetch } from '../src/ui/lib/network'

type Res = Parameters<typeof resourceCategory>[0]

function res(opts: {
  url?: string
  method?: string
  status?: number
  type?: string
  mime?: string
  contentSize?: number
  transferSize?: number
  reqHeaders?: { name: string, value: string }[]
  respHeaders?: { name: string, value: string }[]
  postData?: string
  monotonicTime?: number
  time?: number
} = {}): Res {
  return {
    id: 'r1',
    request: {
      url: opts.url ?? 'https://example.com/path/file.js',
      method: opts.method ?? 'GET',
      headers: opts.reqHeaders ?? [],
      postData: opts.postData ? { text: opts.postData } : undefined,
    },
    response: {
      status: opts.status ?? 200,
      content: { mimeType: opts.mime ?? '', size: opts.contentSize },
      _transferSize: opts.transferSize,
      headers: opts.respHeaders ?? [],
    },
    _resourceType: opts.type,
    _monotonicTime: opts.monotonicTime ?? 0,
    time: opts.time ?? 1,
  } as unknown as Res
}

describe('resourceCategory', () => {
  it('classifies by resource type', () => {
    expect(resourceCategory(res({ type: 'document' }))).toBe('HTML')
    expect(resourceCategory(res({ type: 'stylesheet' }))).toBe('CSS')
    expect(resourceCategory(res({ type: 'script' }))).toBe('JS')
    expect(resourceCategory(res({ type: 'font' }))).toBe('Font')
    expect(resourceCategory(res({ type: 'image' }))).toBe('Image')
    expect(resourceCategory(res({ type: 'xhr' }))).toBe('Fetch')
  })

  it('falls back to the mime type, then Other', () => {
    expect(resourceCategory(res({ mime: 'text/html' }))).toBe('HTML')
    expect(resourceCategory(res({ mime: 'image/png' }))).toBe('Image')
    expect(resourceCategory(res({ type: 'manifest', mime: 'application/manifest+json' }))).toBe('Other')
  })
})

describe('formatSize', () => {
  it('formats bytes, KB, MB and dashes empty', () => {
    expect(formatSize(0)).toBe('-')
    expect(formatSize(-1)).toBe('-')
    expect(formatSize(512)).toBe('512 B')
    expect(formatSize(2048)).toBe('2.0 KB')
    expect(formatSize(3 * 1024 * 1024)).toBe('3.0 MB')
  })
})

describe('statusClass', () => {
  it('maps status ranges to tone classes', () => {
    expect(statusClass(0)).toBe('text-muted-foreground')
    expect(statusClass(200)).toBe('text-pass')
    expect(statusClass(301)).toBe('text-flaky')
    expect(statusClass(404)).toBe('text-fail')
    expect(statusClass(503)).toBe('text-fail')
  })
})

describe('allResources', () => {
  it('maps every resource to a row', () => {
    const rows = allResources([
      res({ url: 'https://x/a.js', status: 200 }),
      res({ url: 'not a url', status: 404 }),
    ])
    expect(rows.map(r => r.name)).toEqual(['a.js', 'not a url'])
    expect(rows.map(r => r.status)).toEqual([200, 404])
  })
})

describe('toCurl', () => {
  it('builds a GET curl with just the url', () => {
    expect(toCurl(res({ url: 'https://x/a' }))).toBe(`curl 'https://x/a'`)
  })

  it('adds method, headers, and a shell-quoted body', () => {
    const curl = toCurl(res({
      url: 'https://x/a',
      method: 'POST',
      reqHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      postData: '{"a":1}',
    }))
    expect(curl).toContain(`curl 'https://x/a'`)
    expect(curl).toContain('-X POST')
    expect(curl).toContain(`-H 'Content-Type: application/json'`)
    expect(curl).toContain(`--data-raw '{"a":1}'`)
  })

  it('escapes single quotes in values', () => {
    expect(toCurl(res({ url: `https://x/it's` }))).toContain(`'https://x/it'\\''s'`)
  })
})

describe('toFetch', () => {
  it('builds a fetch snippet with method, headers, and body', () => {
    expect(toFetch(res({
      url: 'https://x/a',
      method: 'POST',
      reqHeaders: [{ name: 'Content-Type', value: 'application/json' }],
      postData: '{"a":1}',
    }))).toBe(`fetch("https://x/a", {
  "method": "POST",
  "headers": {
    "Content-Type": "application/json"
  },
  "body": "{\\"a\\":1}"
})`)
  })
})

describe('bodyUrl', () => {
  it('returns undefined without a model or file', () => {
    expect(bodyUrl(null, 'body.txt')).toBeUndefined()
    expect(bodyUrl({ createRelativeUrl: path => path }, undefined)).toBeUndefined()
  })

  it('creates a trace-relative file url', () => {
    expect(bodyUrl({ createRelativeUrl: path => `/viewer/${path}` }, 'resources/body.txt')).toBe('/viewer/file/resources/body.txt')
  })
})

describe('prettyJson', () => {
  it('indents JSON when the mime is json', () => {
    expect(prettyJson('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}')
  })

  it('sniffs JSON by shape when the mime lies', () => {
    expect(prettyJson('  [1,2]', 'text/plain')).toBe('[\n  1,\n  2\n]')
  })

  it('returns null for non-JSON text', () => {
    expect(prettyJson('hello', 'text/plain')).toBeNull()
  })

  it('returns null for JSON-mime bodies that do not parse', () => {
    expect(prettyJson('{bad', 'application/json')).toBeNull()
  })
})

describe('resourcesForAction', () => {
  type Action = Parameters<typeof resourcesForAction>[1]
  const action = { startTime: 100, endTime: 200 } as unknown as Action

  it('returns rows up to the action end time, skipping later ones', () => {
    const rows = resourcesForAction(
      [
        res({ url: 'https://x/early', monotonicTime: 150, status: 200 }),
        res({ url: 'https://x/late', monotonicTime: 250 }),
      ],
      action,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].url).toBe('https://x/early')
  })

  it('returns nothing without an action', () => {
    expect(resourcesForAction([res({})], undefined)).toEqual([])
  })

  it('resolves the response size: content size, then transfer size, then content-length', () => {
    const action = { startTime: 0, endTime: 1000 } as unknown as Action
    const [content] = resourcesForAction([res({ contentSize: 900, transferSize: 1234, monotonicTime: 10 })], action)
    expect(content.size).toBe(900)
    const [transfer] = resourcesForAction([res({ contentSize: 0, transferSize: 1234, monotonicTime: 10 })], action)
    expect(transfer.size).toBe(1234)
    const [header] = resourcesForAction([res({ contentSize: 0, respHeaders: [{ name: 'Content-Length', value: '500' }], monotonicTime: 10 })], action)
    expect(header.size).toBe(500)
  })
})

describe('resourcesInWindow', () => {
  it('keeps only resources whose start falls inside the window (bounds inclusive)', () => {
    const rows = resourcesInWindow(
      [
        res({ url: 'https://x/before', monotonicTime: 50 }),
        res({ url: 'https://x/at-start', monotonicTime: 100 }),
        res({ url: 'https://x/inside', monotonicTime: 150 }),
        res({ url: 'https://x/at-end', monotonicTime: 200 }),
        res({ url: 'https://x/after', monotonicTime: 250 }),
      ],
      { start: 100, end: 200 },
    )
    expect(rows.map(r => r.url)).toEqual(['https://x/at-start', 'https://x/inside', 'https://x/at-end'])
  })
})

describe('routeOutcome', () => {
  it('is undefined when no route handled the request', () => {
    expect(routeOutcome(res())).toBeUndefined()
    expect(allResources([res()])[0].route).toBeUndefined()
  })

  it('reports how a route settled the request', () => {
    expect(routeOutcome({ ...res(), _wasFulfilled: true })).toBe('fulfilled')
    expect(routeOutcome({ ...res(), _wasContinued: true })).toBe('continued')
    expect(routeOutcome({ ...res(), _wasAborted: true })).toBe('aborted')
    expect(allResources([{ ...res(), _wasFulfilled: true }])[0].route).toBe('fulfilled')
  })
})

describe('networkMatches', () => {
  const row = (extra: Partial<Res> = {}, opts: Parameters<typeof res>[0] = {}) => allResources([{ ...res(opts), ...extra }])[0]

  it('matches nothing for an empty query', () => {
    expect(networkMatches(row(), '')).toEqual([])
  })

  it('finds the query in the url, headers and inline request body', () => {
    const r = row({}, { url: 'https://api.example.com/graphql?op=GetTeam', method: 'POST', reqHeaders: [{ name: 'X-Team', value: 'Rockets' }], postData: '{"query":"query GetTeam { roster }"}' })
    expect(networkMatches(r, 'getteam')).toEqual(['url', 'request body'])
    expect(networkMatches(r, 'rockets')).toEqual(['headers'])
    expect(networkMatches(r, 'roster')).toEqual(['request body'])
  })

  it('finds the query in a loaded response body', () => {
    expect(networkMatches(row(), 'scout-builder', '{"name":"scout-builder"}')).toEqual(['response body'])
    expect(networkMatches(row(), 'scout-builder')).toEqual([])
  })
})

describe('searchableResponseFile', () => {
  it('returns text-like bodies stored in the trace only', () => {
    const json = { ...res({ mime: 'application/json' }) }
    json.response.content._file = 'abc.json'
    expect(searchableResponseFile(json)).toBe('abc.json')
    const img = { ...res({ mime: 'image/png' }) }
    img.response.content._file = 'abc.png'
    expect(searchableResponseFile(img)).toBeUndefined()
    expect(searchableResponseFile(res({ mime: 'application/json' }))).toBeUndefined()
  })
})

describe('request body search', () => {
  it('searches a request body stored as a trace file once loaded', () => {
    const r = allResources([res({ method: 'POST' })])[0]
    expect(networkMatches(r, 'getroster', undefined, '{"operationname":"getroster"}')).toEqual(['request body'])
  })

  it('fetches only stored, text-like request bodies', () => {
    const stored = res({ method: 'POST', reqHeaders: [{ name: 'Content-Type', value: 'application/json' }] })
    stored.request.postData = { mimeType: 'application/json', _file: 'req.json' } as typeof stored.request.postData
    expect(searchableRequestFile(stored)).toBe('req.json')
    expect(searchableRequestFile(res({ method: 'POST', postData: 'inline' }))).toBeUndefined()
    const binary = res({ method: 'POST' })
    binary.request.postData = { mimeType: 'application/octet-stream', _file: 'blob.bin' } as typeof binary.request.postData
    expect(searchableRequestFile(binary)).toBeUndefined()
  })
})
