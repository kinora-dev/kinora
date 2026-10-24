#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const mode = process.argv.includes('--check') ? 'check' : 'write'
const version = await resolvePlaywrightVersion()
const tag = `v${version}`
const baseUrl = `https://raw.githubusercontent.com/microsoft/playwright/${tag}`

const isomorphicFiles = [
  'ariaSnapshotRenderer.ts',
  'cssParser.ts',
  'cssTokenizer.ts',
  'locatorGenerators.ts',
  'locatorParser.ts',
  'lruCache.ts',
  'mimeType.ts',
  'protocolFormatter.ts',
  'protocolMetainfo.ts',
  'selectorParser.ts',
  'stringUtils.ts',
  'types.ts',
  'trace/entries.ts',
  'trace/snapshotRenderer.ts',
  'trace/snapshotServer.ts',
  'trace/snapshotStorage.ts',
  'trace/trace.ts',
  'trace/traceLoader.ts',
  'trace/traceModel.ts',
  'trace/traceModernizer.ts',
  'trace/traceUtils.ts',
  ...await fetchTraceVersionFiles(),
]

const swFiles = [
  'main.ts',
  'progress.ts',
  'traceLoaderBackends.ts',
]

// Upstream path aliases, so imports between vendored files can be followed.
const ALIASES = {
  '@injected/': 'packages/injected/src/',
  '@isomorphic/': 'packages/isomorphic/',
  '@recorder/': 'packages/recorder/src/',
}

// The injected script and recorder power the snapshot picker, locator highlighting and the console API.
const injectedFiles = [
  'injectedScript.ts',
  'recorder/recorder.ts',
]

const downloads = [
  ...injectedFiles.map(file => ({
    upstream: `packages/injected/src/${file}`,
    local: `packages/trace-viewer/src/core/injected/${file}`,
  })),
  ...isomorphicFiles.map(file => ({
    upstream: `packages/isomorphic/${file}`,
    local: `packages/trace-viewer/src/core/isomorphic/${file}`,
  })),
  ...swFiles.map(file => ({
    upstream: `packages/trace-viewer/src/sw/${file}`,
    local: `packages/trace-viewer/src/sw/${file}`,
  })),
  {
    upstream: 'packages/protocol/src/structs.d.ts',
    local: 'packages/trace-viewer/src/core/protocol/structs.d.ts',
  },
  // "Copy as Playwright" request codegen (JS, Python, Java, C#); it only imports vendored types.
  {
    upstream: 'packages/trace-viewer/src/ui/codegen.ts',
    local: 'packages/trace-viewer/src/core/ui/codegen.ts',
  },
  // "Copy as cURL / fetch" (Chromium DevTools): skips hop-by-hop headers, reads bodies stored as files.
  {
    upstream: 'packages/trace-viewer/src/third_party/devtools.ts',
    local: 'packages/trace-viewer/src/core/ui/devtools.ts',
  },
]

const generated = [
  {
    local: 'packages/trace-viewer/src/core/trace/trace.ts',
    content: `export type * from '@isomorphic/trace/trace'\n`,
  },
  {
    local: 'packages/trace-viewer/src/core/trace/snapshot.ts',
    content: `export type { FrameSnapshot, NodeNameAttributesChildNodesSnapshot, NodeSnapshot, ResourceOverride, ResourceSnapshot, SubtreeReferenceSnapshot } from '@isomorphic/trace/trace'\n`,
  },
  {
    local: 'packages/trace-viewer/src/core/trace/har.ts',
    content: `export type * from '@isomorphic/trace/versions/har'\n`,
  },
  {
    local: 'packages/trace-viewer/src/core/trace/VENDORED_VERSION',
    content: `${tag}\n`,
  },
]

const stale = []

// The lists above are the entry points. Upstream regularly splits code into new files (1.64's
// service worker started importing `@isomorphic/istanbulCoverage`), so follow the imports of
// everything downloaded and fetch whatever is missing, instead of trusting a fixed list.
const queue = downloads.map(item => ({ ...item, candidates: [item.upstream] }))
const seen = new Set(queue.map(item => item.upstream))
for (let item = queue.shift(); item; item = queue.shift()) {
  const { upstream, content } = await fetchFirst(item.candidates)
  await handleFile(localPathOf(upstream) ?? item.local, content)
  for (const candidates of importedFiles(upstream, content)) {
    if (seen.has(candidates[0]))
      continue
    seen.add(candidates[0])
    queue.push({ candidates, local: localPathOf(candidates[0]) })
    console.log(`  + ${candidates[0]} (imported by ${upstream})`)
  }
}

for (const item of generated)
  await handleFile(item.local, item.content)

await handleReadmeVersion()

if (mode === 'check') {
  if (stale.length) {
    console.error(`Playwright trace viewer vendored code is out of sync with ${tag}:`)
    for (const file of stale)
      console.error(`  ${file}`)
    console.error('Run: pnpm vendor:playwright-trace')
    process.exit(1)
  }
  console.log(`Playwright trace viewer vendored code is in sync with ${tag}.`)
}
else {
  console.log(`Synced Playwright trace viewer vendored code from ${tag}.`)
}

// Upstream files a vendored file imports, limited to the trees we vendor. Other aliases
// (`@protocol`, `@trace`, npm packages) are covered by the explicit downloads and generated shims.
// Each import resolves to candidate paths: a bare specifier may be a `.ts` or a type-only `.d.ts`.
function importedFiles(upstream, content) {
  const files = []
  for (const [, raw] of content.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) {
    // `?inline` (and other Vite queries) only change how the file is bundled.
    const specifier = raw.replace(/\?.*$/, '')
    const alias = Object.keys(ALIASES).find(prefix => specifier.startsWith(prefix))
    const target = alias
      ? ALIASES[alias] + specifier.slice(alias.length)
      : specifier.startsWith('.') ? path.posix.join(path.posix.dirname(upstream), specifier) : undefined
    if (!target || !localPathOf(target))
      continue
    files.push(/\.\w+$/.test(target) && !target.endsWith('.d') ? [target] : [`${target}.ts`, `${target}.d.ts`])
  }
  return files
}

async function fetchFirst(candidates) {
  for (const [i, upstream] of candidates.entries()) {
    try {
      return { upstream, content: await fetchText(`${baseUrl}/${upstream}`) }
    }
    catch (error) {
      if (i === candidates.length - 1)
        throw error
    }
  }
  throw new Error('No candidate path')
}

function localPathOf(upstream) {
  const roots = [
    ['packages/isomorphic/', 'packages/trace-viewer/src/core/isomorphic/'],
    ['packages/injected/src/', 'packages/trace-viewer/src/core/injected/'],
    ['packages/recorder/src/', 'packages/trace-viewer/src/core/recorder/'],
    ['packages/trace-viewer/src/sw/', 'packages/trace-viewer/src/sw/'],
  ]
  const root = roots.find(([from]) => upstream.startsWith(from))
  return root && root[1] + upstream.slice(root[0].length)
}

async function handleFile(local, content) {
  const localPath = path.join(root, local)
  const previous = existsSync(localPath) ? await readFile(localPath, 'utf8') : undefined
  if (previous === content)
    return
  if (mode === 'check') {
    stale.push(local)
    return
  }
  await mkdir(path.dirname(localPath), { recursive: true })
  await writeFile(localPath, content)
}

async function handleReadmeVersion() {
  const local = 'packages/trace-viewer/README.md'
  const localPath = path.join(root, local)
  const previous = await readFile(localPath, 'utf8')
  const content = previous.replace(/synced from Playwright `v[^`]+`/, `synced from Playwright \`${tag}\``)
  if (previous === content)
    return
  if (mode === 'check') {
    stale.push(local)
    return
  }
  await writeFile(localPath, content)
}

async function fetchText(url) {
  const response = await fetch(url, { headers: { 'User-Agent': 'kinora-vendor-playwright-trace-viewer' } })
  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  return await response.text()
}

async function fetchJson(url) {
  const headers = { 'User-Agent': 'kinora-vendor-playwright-trace-viewer' }
  if (process.env.GITHUB_TOKEN)
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  const response = await fetch(url, { headers })
  if (!response.ok)
    throw new Error(`Failed to fetch ${url}: ${response.status} ${response.statusText}`)
  return await response.json()
}

async function fetchTraceVersionFiles() {
  const url = `https://api.github.com/repos/microsoft/playwright/contents/packages/isomorphic/trace/versions?ref=${tag}`
  const entries = await fetchJson(url)
  return entries
    .filter(entry => entry.type === 'file' && entry.name.endsWith('.ts'))
    .map(entry => `trace/versions/${entry.name}`)
    .sort()
}

async function resolvePlaywrightVersion() {
  const packageJson = path.join(root, 'packages/trace-viewer/node_modules/@playwright/test/package.json')
  if (existsSync(packageJson)) {
    const pkg = JSON.parse(await readFile(packageJson, 'utf8'))
    return pkg.version
  }

  const lockfile = await readFile(path.join(root, 'pnpm-lock.yaml'), 'utf8')
  const match = lockfile.match(/^\s*'@playwright\/test@(\d+\.\d+\.\d+)':/m)
  if (match)
    return match[1]

  throw new Error('Could not resolve installed @playwright/test version. Run pnpm install first.')
}
