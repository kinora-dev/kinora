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
  'cssParser.ts',
  'cssTokenizer.ts',
  'locatorGenerators.ts',
  'lruCache.ts',
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

const downloads = [
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

for (const item of downloads) {
  const content = await fetchText(`${baseUrl}/${item.upstream}`)
  await handleFile(item.local, content)
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
  const response = await fetch(url, { headers: { 'User-Agent': 'kinora-vendor-playwright-trace-viewer' } })
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
