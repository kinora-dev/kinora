#!/usr/bin/env node
import { Buffer } from 'node:buffer'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { BlobReader, BlobWriter, ZipReader, ZipWriter } from '@zip.js/zip.js'

const execFileAsync = promisify(execFile)
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const fixtures = path.join(root, 'public/fixtures')
const playwrightBin = path.join(root, 'node_modules/.bin/playwright')

await generateDemoTrace()
await generateAriaTrace()
await generateScenarioTraces()
await sanitizeFixturePaths()

async function generateDemoTrace() {
  const tmpRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp'
  const tmp = path.join(tmpRoot, 'kinora-trace-fixtures')
  await rm(tmp, { force: true, recursive: true })
  await mkdir(tmp, { recursive: true })
  try {
    await symlink(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir')
    await writeFile(path.join(tmp, 'playwright.config.mjs'), `
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'on',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
`)
    await writeFile(path.join(tmp, 'demo.spec.ts'), `
import { expect, test } from '@playwright/test'

test('checkout flow demo', async ({ page }, testInfo) => {
  await page.route('**/style.css', route => route.fulfill({
    contentType: 'text/css',
    body: \`
*{box-sizing:border-box}
html{color-scheme:light}
body{margin:0;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-size:15px;line-height:1.5;color:#14171f;background:#fff;-webkit-font-smoothing:antialiased}
.shell{display:grid;grid-template-columns:minmax(0,1fr) 400px;min-height:100vh}
.checkout{padding:40px 72px 56px;max-width:820px;width:100%;justify-self:end}
.brand{display:flex;align-items:center;gap:10px;font-weight:600;letter-spacing:-.01em}
.mark{display:block;border-radius:7px}
.steps{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:44px 0 0;padding:0;list-style:none}
.step{border-top:2px solid #e3e6eb;padding-top:10px;color:#5b6472;font-size:13px}
.step strong{display:block;color:#14171f;font-size:14px;font-weight:600}
.step.done{border-top-color:#15803d}
.step.done strong::after{content:"\\\\2713";margin-left:6px;color:#15803d}
h1{margin:40px 0 8px;font-size:40px;line-height:1.1;font-weight:650;letter-spacing:-.03em}
.lead{margin:0 0 32px;max-width:52ch;color:#5b6472;font-size:16px}
.field{display:block;margin-bottom:6px;font-size:13px;font-weight:600}
.form{display:flex;gap:10px}
.input{flex:1;min-width:0;max-width:340px;border:1px solid #c9ced6;border-radius:8px;background:#fff;color:inherit;padding:11px 12px;font:inherit}
.input::placeholder{color:#8a93a1}
.input:focus{outline:2px solid #14171f;outline-offset:1px;border-color:#14171f}
button{border:0;border-radius:8px;background:#f59e0b;color:#14171f;padding:11px 18px;font:inherit;font-weight:600;cursor:pointer}
button:hover{background:#e8930a}
button:focus-visible{outline:2px solid #14171f;outline-offset:2px}
.receipt{display:none;margin-top:28px;border-left:2px solid #15803d;padding:2px 0 2px 14px;color:#14171f}
.receipt.visible{display:block}
.side{border-left:1px solid #e3e6eb;background:#f6f7f9;padding:104px 44px 56px}
.side h2{margin:0 0 12px;font-size:15px;font-weight:600}
.row{display:flex;justify-content:space-between;gap:16px;border-bottom:1px solid #e3e6eb;padding:12px 0;color:#5b6472}
.row strong{color:#14171f;font-weight:500;font-variant-numeric:tabular-nums}
.total{display:flex;justify-content:space-between;align-items:baseline;padding-top:16px;font-weight:600}
.total strong{font-size:24px;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.trust{margin:28px 0 0;color:#5b6472;font-size:13px}
@media (max-width:820px){.shell{grid-template-columns:1fr}.checkout{padding:28px 24px 36px}.side{border-left:0;border-top:1px solid #e3e6eb;padding:28px 24px}.form{flex-direction:column}.input{max-width:none}}
\`,
  }))
  await page.route('**/logo.svg', route => route.fulfill({
    contentType: 'image/svg+xml',
    body: \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="16" fill="#f59e0b"/><path d="M18 42V22h8v7l12-7h8L33 32l13 10h-9l-11-8v8z" fill="#111827"/></svg>\`,
  }))

  await page.setContent(\`<!doctype html><html><head>
    <link rel="stylesheet" href="https://demo.kinora.dev/style.css">
    </head><body>
    <main class="shell">
      <section class="checkout">
        <div class="brand">
          <img class="mark" src="https://demo.kinora.dev/logo.svg" width="28" height="28" alt="Kinora logo">
          <span>Kinora Store</span>
        </div>
        <ol class="steps" aria-label="Checkout steps">
          <li class="step done"><strong>Cart</strong>Pro plan selected</li>
          <li class="step done"><strong>Details</strong>Customer ready</li>
          <li class="step" id="confirm-step"><strong>Confirm</strong>Waiting for payment</li>
        </ol>
        <h1 id="title">Checkout</h1>
        <p id="message" class="lead">Kinora Pro for one seat, billed monthly. Change seats or cancel whenever you like.</p>
        <label class="field" for="customer">Customer email</label>
        <div class="form">
          <input class="input" id="customer" type="email" placeholder="you@company.com">
          <button id="complete">Complete checkout</button>
        </div>
        <div id="receipt" class="receipt" role="status">Receipt sent to alex@example.com.</div>
      </section>
      <aside class="side" aria-label="Order summary">
        <h2>Order summary</h2>
        <div class="row"><span>Kinora Pro</span><strong>$29</strong></div>
        <div class="row"><span>Team seats</span><strong>1</strong></div>
        <div class="row"><span>Trace retention</span><strong>90 days</strong></div>
        <div class="total"><span>Total due today</span><strong>$29</strong></div>
        <p class="trust">Every test run keeps its trace, network log, and console output for 90 days.</p>
      </aside>
    </main>
    <script>
      document.getElementById('complete').addEventListener('click', () => {
        const customer = document.getElementById('customer').value;
        console.log('order submitted, customer =', customer);
        console.warn('demo warning from checkout flow');
        document.getElementById('title').textContent = 'Order complete';
        document.getElementById('message').textContent = 'Your team can start uploading Playwright runs right away.';
        document.getElementById('confirm-step').classList.add('done');
        document.getElementById('confirm-step').lastChild.textContent = 'Payment confirmed';
        document.getElementById('receipt').classList.add('visible');
      });
    </script>
  </body></html>\`, { baseURL: 'https://demo.kinora.dev' })

  await page.fill('#customer', 'alex@example.com')
  await page.click('#complete')
  await expect(page.locator('#title')).toHaveText('Order complete')

  await testInfo.attach('screenshot', { body: await page.screenshot(), contentType: 'image/png' })
  await testInfo.attach('note', { body: 'Demo trace generated for Kinora', contentType: 'text/plain' })
})
`)

    await execFileAsync(playwrightBin, ['test', '--config', 'playwright.config.mjs'], { cwd: tmp })
    const trace = await findTraceZip(path.join(tmp, 'test-results'))
    await writeFile(path.join(fixtures, 'demo.zip'), await readFile(trace))
    console.log(`Generated ${path.relative(process.cwd(), path.join(fixtures, 'demo.zip'))}`)
  }
  finally {
    await rm(tmp, { force: true, recursive: true })
  }
}

async function generateScenarioTraces() {
  await generateTraceFixture('iframe-trace.zip', iframeSpec())
  await generateTraceFixture('popup-trace.zip', popupSpec())
  await generateTraceFixture('network-rich-trace.zip', networkRichSpec())
  await generateTraceFixture('console-rich-trace.zip', consoleRichSpec())
  await generateTraceFixture('annotations-trace.zip', annotationsSpec())
  await generateTraceFixture('error-trace.zip', errorSpec(), { file: 'demo.spec.ts', fails: true })
}

async function generateTraceFixture(name, spec, { file = 'fixture.spec.ts', fails = false } = {}) {
  const tmpRoot = process.platform === 'win32' ? os.tmpdir() : '/tmp'
  const tmp = path.join(tmpRoot, `kinora-trace-fixture-${name.replace(/\.zip$/, '')}`)
  await rm(tmp, { force: true, recursive: true })
  await mkdir(tmp, { recursive: true })
  try {
    await symlink(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'), 'dir')
    await writeFile(path.join(tmp, 'playwright.config.mjs'), playwrightConfig())
    await writeFile(path.join(tmp, file), spec)
    // A failing fixture makes Playwright exit 1, but it still writes the trace.
    await execFileAsync(playwrightBin, ['test', '--config', 'playwright.config.mjs'], { cwd: tmp })
      .catch((error) => {
        if (!fails)
          throw error
      })
    const trace = await findTraceZip(path.join(tmp, 'test-results'))
    const target = path.join(fixtures, name)
    await writeFile(target, await readFile(trace))
    console.log(`Generated ${path.relative(process.cwd(), target)}`)
  }
  finally {
    await rm(tmp, { force: true, recursive: true })
  }
}

function playwrightConfig() {
  return `
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  retries: 0,
  reporter: 'list',
  use: {
    ...devices['Desktop Chrome'],
    trace: 'on',
  },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
})
`
}

function iframeSpec() {
  return String.raw`
import { expect, test } from '@playwright/test'

test('iframe checkout support', async ({ page }) => {
  await page.setContent([
    '<main>',
    '<h1>Iframe payment shell</h1>',
    '<iframe title="Payment frame" srcdoc="<form><label>Card holder <input id=cardholder placeholder=Cardholder></label><button id=pay type=button>Pay invoice</button><p id=status>Waiting</p><script>document.getElementById(&quot;pay&quot;).addEventListener(&quot;click&quot;,()=>{document.getElementById(&quot;status&quot;).textContent=&quot;Paid inside iframe&quot;;console.log(&quot;iframe payment submitted&quot;)})<\/script></form>"></iframe>',
    '</main>',
  ].join(''))
  const frame = page.frameLocator('iframe[title="Payment frame"]')
  await frame.locator('#cardholder').fill('Alex Example')
  await frame.getByRole('button', { name: 'Pay invoice' }).click()
  await expect(frame.getByText('Paid inside iframe')).toBeVisible()
})
`
}

function popupSpec() {
  return String.raw`
import { expect, test } from '@playwright/test'

test('popup receipt support', async ({ page, context }) => {
  await context.route('**/receipt.html', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><title>Receipt</title><main><h1>Receipt popup</h1><button id="close">Close receipt</button><script>console.log("popup receipt opened")<\/script></main>',
  }))
  await page.setContent('<button id="open">Open receipt</button><script>document.getElementById("open").addEventListener("click",()=>window.open("https://demo.kinora.dev/receipt.html","receipt"))<\/script>', { baseURL: 'https://demo.kinora.dev' })
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Open receipt' }).click()
  const popup = await popupPromise
  await popup.waitForLoadState('domcontentloaded')
  await expect(popup.getByRole('heading', { name: 'Receipt popup' })).toBeVisible()
  await popup.getByRole('button', { name: 'Close receipt' }).click()
})
`
}

function networkRichSpec() {
  return String.raw`
import { expect, test } from '@playwright/test'

test('rich network activity', async ({ page }) => {
  await page.route('**/api/cart', route => route.fulfill({
    contentType: 'application/json',
    headers: { 'x-demo': 'cart' },
    body: JSON.stringify({ plan: 'Pro', seats: 1 }),
  }))
  await page.route('**/api/checkout', async (route) => {
    const post = route.request().postDataJSON()
    await route.fulfill({
      contentType: 'application/json',
      status: 201,
      headers: { 'x-demo': 'checkout' },
      body: JSON.stringify({ ok: true, email: post.email }),
    })
  })
  await page.route('**/api/missing', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found' }) }))
  await page.route('**/api/error', route => route.fulfill({ status: 500, contentType: 'text/plain', body: 'server exploded' }))
  await page.setContent('<button id="load">Load network</button><pre id="out"></pre><script>document.getElementById("load").addEventListener("click",async()=>{const cart=await fetch("https://demo.kinora.dev/api/cart").then(r=>r.json());const checkout=await fetch("https://demo.kinora.dev/api/checkout",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:"alex@example.com",plan:cart.plan})}).then(r=>r.json());await fetch("https://demo.kinora.dev/api/missing");await fetch("https://demo.kinora.dev/api/error");console.log("network checkout",checkout.email);document.getElementById("out").textContent=checkout.email})<\/script>')
  await page.getByRole('button', { name: 'Load network' }).click()
  await expect(page.locator('#out')).toHaveText('alex@example.com')
})
`
}

function consoleRichSpec() {
  return String.raw`
import { expect, test } from '@playwright/test'

test('rich console output', async ({ page }) => {
  await page.setContent('<button id="run">Run console</button><output id="done"></output><script>document.getElementById("run").addEventListener("click",()=>{console.log("checkout state",{step:"payment",total:29});console.info("info message",["trace","viewer"]);console.warn("payment latency warning");console.error("payment failed",{code:"card_declined"});document.getElementById("done").textContent="console complete"})<\/script>', { baseURL: 'https://demo.kinora.dev' })
  await page.getByRole('button', { name: 'Run console' }).click()
  await expect(page.locator('#done')).toHaveText('console complete')
})
`
}

function annotationsSpec() {
  return String.raw`
import { expect, test } from '@playwright/test'

test('annotation metadata support', async ({ page }, testInfo) => {
  testInfo.annotations.push({ type: 'issue', description: 'https://kinora.dev/docs/trace-viewer' })
  testInfo.annotations.push({ type: 'owner', description: 'QA platform team' })
  await page.setContent('<main><h1>Annotated trace</h1><p>Custom annotations are visible in the viewer.</p></main>')
  await expect(page.getByRole('heading', { name: 'Annotated trace' })).toBeVisible()
})
`
}

// Failing run: carries the `error-context` attachment behind the Errors tab "Copy prompt".
function errorSpec() {
  return String.raw`
import { expect, test } from '@playwright/test'

test('completes a purchase', async ({ page }) => {
  await page.setContent('<main><h1>Checkout</h1><button>Add to cart</button></main>')
  await expect(page.getByRole('button', { name: 'Pay now' })).toBeVisible({ timeout: 1500 })
})
`
}

async function findTraceZip(dir) {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true })
  const entry = entries.find(entry => entry.isFile() && entry.name === 'trace.zip')
  if (!entry)
    throw new Error(`Could not find trace.zip under ${dir}`)
  return path.join(entry.parentPath, entry.name)
}

async function generateAriaTrace() {
  const source = path.join(fixtures, 'demo.zip')
  const target = path.join(fixtures, 'aria-trace.zip')
  const ariaFile = 'resources/aria-checkout.yml'
  const ariaText = `- document:
  - heading "Order complete" [level=1]
  - textbox "Customer email": alex@example.com
  - button "Complete checkout"
`

  const entries = await readZip(source)
  const libraryTraceEntry = [...entries.keys()].find((name) => {
    if (!/^\d+-trace\.trace$/.test(name))
      return false
    const trace = decode(entries.get(name))
    return !!trace && !!tryFindEvent(trace, event => event.type === 'before' && event.method === 'click' && event.params?.selector === '#complete')
  })
  const trace = libraryTraceEntry ? decode(entries.get(libraryTraceEntry)) : undefined
  const testTrace = decode(entries.get('test.trace'))
  if (!trace || !testTrace || !libraryTraceEntry)
    throw new Error('demo.zip is missing trace files')

  const libraryClick = findEvent(trace, event => event.type === 'before' && event.method === 'click' && event.params?.selector === '#complete')
  const testClick = findEvent(testTrace, event => event.type === 'before' && String(event.params?.selector ?? event.params?.locator ?? '').includes('#complete'))
  const pageId = libraryClick?.pageId ?? 'page@kinora-demo'
  const timestamp = libraryClick?.startTime ?? 0
  const events = [
    { type: 'aria-snapshot', callId: libraryClick.callId, phase: 'action', pageId, timestamp, file: ariaFile },
    { type: 'aria-snapshot', callId: libraryClick.callId, phase: 'after', pageId, timestamp, file: ariaFile },
    { type: 'aria-snapshot', callId: testClick.callId, phase: 'action', pageId, timestamp, file: ariaFile },
    { type: 'aria-snapshot', callId: testClick.callId, phase: 'after', pageId, timestamp, file: ariaFile },
  ]
  entries.set(libraryTraceEntry, encode(`${trace.trimEnd()}\n${events.map(event => JSON.stringify(event)).join('\n')}\n`))
  entries.set(ariaFile, encode(ariaText))

  await writeZip(target, entries)
  console.log(`Generated ${path.relative(process.cwd(), target)}`)
}

function tryFindEvent(trace, predicate) {
  for (const line of trace.split('\n')) {
    if (!line.trim())
      continue
    const event = JSON.parse(line)
    if (predicate(event))
      return event
  }
}

function findEvent(trace, predicate) {
  const event = tryFindEvent(trace, predicate)
  if (!event)
    throw new Error('Could not find expected trace event')
  return event
}

async function readZip(file) {
  const bytes = await readFile(file)
  const reader = new ZipReader(new BlobReader(new Blob([bytes])))
  const entries = new Map()
  for (const entry of await reader.getEntries()) {
    if (!entry.getData)
      continue
    const blob = await entry.getData(new BlobWriter())
    entries.set(entry.filename, new Uint8Array(await blob.arrayBuffer()))
  }
  await reader.close()
  return entries
}

async function writeZip(file, entries) {
  await mkdir(path.dirname(file), { recursive: true })
  const writer = new ZipWriter(new BlobWriter('application/zip'))
  for (const [name, bytes] of entries)
    await writer.add(name, new BlobReader(new Blob([bytes])))
  const blob = await writer.close()
  await writeFile(file, Buffer.from(await blob.arrayBuffer()))
}

function decode(value) {
  return value ? new TextDecoder().decode(value) : undefined
}

function encode(value) {
  return new TextEncoder().encode(value)
}

async function sanitizeFixturePaths() {
  for (const name of await readdir(fixtures)) {
    if (!name.endsWith('.zip'))
      continue
    const file = path.join(fixtures, name)
    const entries = await readZip(file)
    let changed = false

    for (const [entryName, bytes] of [...entries]) {
      if (!isTextEntry(entryName))
        continue
      const text = decode(bytes)
      const sanitized = sanitizeText(text, entries)
      if (sanitized !== text) {
        entries.set(entryName, encode(sanitized))
        changed = true
      }
    }

    if (changed) {
      await writeZip(file, entries)
      console.log(`Sanitized ${path.relative(process.cwd(), file)}`)
    }
  }
}

function isTextEntry(name) {
  return name.endsWith('.trace') || name.endsWith('.stacks') || name.endsWith('.network') || name.startsWith('src/') || name.startsWith('resources/src@')
}

function sanitizeText(text, entries) {
  return text.replace(/\/(?:private\/)?Users\/joris\/workspace\/kinora[^"'\\\s,}]*/g, path => sanitizePath(path, entries))
    .replace(/\/tmp\/claude-1000\/-home-joris-workspace-kinora[^"'\\\s,}]*/g, path => sanitizePath(path, entries))
}

function sanitizePath(original, entries) {
  let sanitized = original
    .replace(/\/(?:private\/)?Users\/joris\/workspace\/kinora/g, '/tmp/kinora-public-demo')
    .replace(/\/tmp\/claude-1000\/-home-joris-workspace-kinora\/[a-f0-9-]+\/scratchpad\/vidrepro/g, '/tmp/kinora-public-demo/video')
    .replace(/\/tmp\/claude-1000\/-home-joris-workspace-kinora\/[a-f0-9-]+\/scratchpad/g, '/tmp/kinora-public-demo')
  sanitized = sanitized.replaceAll('joris', 'demo')
  duplicateLegacySource(original, sanitized, entries)
  return sanitized
}

function duplicateLegacySource(original, sanitized, entries) {
  const oldName = `resources/src@${sha1(original)}.txt`
  const source = entries.get(oldName)
  if (!source)
    return
  entries.set(`resources/src@${sha1(sanitized)}.txt`, source)
}

function sha1(value) {
  return createHash('sha1').update(value).digest('hex')
}
