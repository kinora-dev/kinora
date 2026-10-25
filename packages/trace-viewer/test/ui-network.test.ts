import { describe, expect, it } from 'vitest'
import { allResources, bodyLang, bodyUrl, contentType, decodeText, formatBody, formatSize, formatXml, networkMatches, resourceAtUrl, resourceCategory, resourceName, resourcesForAction, resourcesInWindow, routeOutcome, searchableRequestFile, searchableResponseFile, statusClass, statusLabel } from '../src/ui/lib/network'

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

  it('counts untyped API requests returning JSON as Fetch', () => {
    expect(resourceCategory(res({ mime: 'application/json; charset=utf-8' }))).toBe('Fetch')
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
    expect(statusClass(304)).toBe('text-pass')
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

describe('network list columns', () => {
  it('keeps the query string in the name', () => {
    expect(resourceName('https://x/api/orders?page=2&sort=desc')).toBe('orders?page=2&sort=desc')
    expect(resourceName('https://x/?q=1')).toBe('x?q=1')
  })

  it('drops the charset from the content type and names websockets', () => {
    expect(contentType(res({ mime: 'text/html; charset=utf-8' }))).toBe('text/html')
    expect(contentType(res({ mime: 'application/json' }))).toBe('application/json')
    expect(contentType(res({ type: 'websocket', mime: '' }))).toBe('websocket')
    expect(resourceCategory(res({ type: 'websocket' }))).toBe('WS')
  })

  it('labels canceled requests as failures', () => {
    expect(statusLabel(-1)).toBe('canceled')
    expect(statusClass(-1)).toBe('text-fail')
    expect(statusLabel(0)).toBe('-')
    expect(statusLabel(204)).toBe('204')
  })

  it('leaves the duration of a request still pending at the end of the trace empty', () => {
    expect(allResources([res({ time: -1 })], {})[0].duration).toBeUndefined()
    expect(allResources([res({ time: 12 })], {})[0].duration).toBe(12)
  })

  it('marks APIRequestContext calls as api', () => {
    expect(routeOutcome({ ...res({}), _apiRequestRef: 'request@1' } as any)).toBe('api')
  })

  it('times rows from the trace start and names their source page', () => {
    const [row] = allResources([{ ...res({ monotonicTime: 1250 }), pageref: 'page@a' } as any], {
      ownerTitles: new Map([['page@a', 'page#1']]),
      startTime: 1000,
    })
    expect(row.start).toBe(250)
    expect(row.source).toBe('page#1')
    expect(allResources([res({})])[0].source).toBe('')
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

describe('formatBody', () => {
  it('pretty-prints JSON and keeps big integers exact', () => {
    expect(formatBody('{"a":1}', 'application/json')).toBe('{\n  "a": 1\n}')
    const big = formatBody('{"id":12345678901234567890}', 'application/json; charset=utf-8')
    if ('rawJSON' in JSON)
      expect(big).toContain('12345678901234567890')
  })

  it('formats JSON sent with a generic type, and leaves other text alone', () => {
    expect(formatBody('  [1,2]', 'text/plain')).toBe('[\n  1,\n  2\n]')
    expect(formatBody('hello', 'text/plain')).toBe('hello')
    expect(formatBody('{bad', 'text/plain')).toBe('{bad')
  })

  it('throws on a malformed JSON body so the UI can flag it', () => {
    expect(() => formatBody('{bad', 'application/json')).toThrow()
  })

  it('decodes form bodies', () => {
    expect(formatBody('plan=Pro+plan&seats=2%2B1', 'application/x-www-form-urlencoded')).toBe('plan=Pro plan&seats=2+1')
  })

  it('indents XML', () => {
    expect(formatXml('<a><b>1</b><c/></a>')).toBe('<a>\n  <b>1</b>\n  <c/>\n</a>')
    expect(formatBody('<a><b>1</b></a>', 'application/xml')).toBe('<a>\n  <b>1</b>\n</a>')
  })
})

describe('decodeText', () => {
  it('decodes UTF-8 text and rejects binary', () => {
    expect(decodeText(new TextEncoder().encode('--b\r\nname=é').buffer)).toBe('--b\r\nname=é')
    expect(decodeText(new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00]).buffer)).toBeUndefined()
    expect(decodeText(new Uint8Array([0xFF, 0xFE, 0xFD]).buffer)).toBeUndefined()
  })
})

describe('bodyLang', () => {
  it('picks the highlighter from the mime type', () => {
    expect(bodyLang('application/json')).toBe('js')
    expect(bodyLang('text/css')).toBe('css')
    expect(bodyLang('text/html; charset=utf-8')).toBe('html')
    expect(bodyLang('text/xml')).toBe('xml')
    expect(bodyLang('text/plain')).toBe('text')
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
    // Upstream's precedence when several flags are set.
    expect(routeOutcome({ ...res(), _wasFulfilled: true, _wasAborted: true })).toBe('aborted')
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

describe('resourceAtUrl', () => {
  it('is undefined when no request has that url', () => {
    expect(resourceAtUrl([res({ url: 'https://example.com/a.js' })], 'https://example.com/b.js', 1000)).toBeUndefined()
  })

  it('picks the closest matching request at or before the given time', () => {
    const early = { ...res({ url: 'https://example.com/a.js', monotonicTime: 100 }), id: 'early' }
    const late = { ...res({ url: 'https://example.com/a.js', monotonicTime: 300 }), id: 'late' }
    const other = { ...res({ url: 'https://example.com/b.js', monotonicTime: 200 }), id: 'other' }
    expect(resourceAtUrl([early, late, other], 'https://example.com/a.js', 250)?.id).toBe('early')
    expect(resourceAtUrl([early, late, other], 'https://example.com/a.js', 1000)?.id).toBe('late')
  })

  it('falls back to the first match when none happened at or before the time', () => {
    const r = { ...res({ url: 'https://example.com/a.js', monotonicTime: 500 }), id: 'r' }
    expect(resourceAtUrl([r], 'https://example.com/a.js', 0)?.id).toBe('r')
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
