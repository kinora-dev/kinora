/* eslint-disable no-console */
import type { ChildProcess } from 'node:child_process'
import type { AgentChange, GitSnapshot } from './agent'
import path from 'node:path'
import process from 'node:process'
import * as Sentry from '@sentry/electron/main'
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { autoUpdater } from 'electron-updater'
import { signIn } from './account'
import { buildFollowUpPrompt, buildRetryPrompt, collectAgentDiff, gitSnapshot, revertAgentChanges, startAgentFix } from './agent'
import { loadConfig, saveConfig } from './config'
import { pollDeviceToken, requestDeviceCode } from './device'
import { openInEditor } from './editor'
import { fetchErrorContext } from './error-context'
import { buildMenu } from './menu'
import { resolveTest } from './resolve'
import { startRerun, watchRepo } from './runner'
import { startServer } from './server'
import { makeTrpc } from './trpc'

// Probes: render headless, assert, exit. VIEWER checks a local trace renders;
// HOME logs in with env creds and checks the project list renders.
const VIEWER_PROBE = process.env.KINORA_DESKTOP_PROBE === '1'
const HOME_PROBE = process.env.KINORA_HOME_PROBE === '1'
const DEVICE_PROBE = process.env.KINORA_DEVICE_PROBE === '1'
const PROBE_TRACE = process.env.KINORA_DESKTOP_TRACE || null

// Dev gets its own userData dir so it doesn't share Chromium storage (service-worker
// DBs, cache) or the saved token with an installed prod app. Must run before any
// storage access (loadConfig below, app ready).
if (!app.isPackaged)
  app.setPath('userData', `${app.getPath('userData')}-dev`)

let port = 0
let homeWin: BrowserWindow | null = null
let viewerWin: BrowserWindow | null = null
let config = loadConfig()

// Packaged builds target the cloud; dev/probe runs stay off (sentryDsn null).
if (app.isPackaged && config.sentryDsn) {
  Sentry.init({
    dsn: config.sentryDsn,
    environment: 'production',
    release: `@kinora/desktop@${app.getVersion()}`,
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
  })
}
// Aborts the in-flight device-flow poll when the user cancels.
let deviceAbort: AbortController | null = null
// The current local test re-run + its produced trace (for "View trace").
let rerunChild: ChildProcess | null = null
let lastRerunTrace: string | null = null
// Bumped per re-run so a killed run's late stdout/close callbacks are ignored.
let rerunGen = 0
// Last re-run target (replayed by watch mode) + the active file watcher's stop fn.
let lastRerunInput: { projectId: string, file: string, line: number, projectName?: string } | null = null
let rerunWatchStop: (() => void) | null = null
// The agent-fix session: survives across retry turns so Revert always restores to the
// pre-agent state and follow-up turns resume the same Claude Code conversation.
interface AgentSession {
  configDir: string
  absFile: string
  input: FixTestIpcInput
  snap: GitSnapshot | null
  sessionId: string | null
  changes: AgentChange[]
  errorContext: string | null
}
let agentChild: ChildProcess | null = null
let agentGen = 0
let agentSession: AgentSession | null = null

// macOS open-file (file association) and argv both hand us a local trace to view.
let pendingOpen: string | null = null
app.on('open-file', (e, p) => {
  e.preventDefault()
  pendingOpen = p
  openViewer(p)
})

function argvTrace(): string | null {
  const last = process.argv[process.argv.length - 1]
  return last && last.toLowerCase().endsWith('.zip') ? path.resolve(last) : null
}

// Packaged: dirs copied into resources. Dev: workspace dep dist + the local Vite build.
function resolveViewerDir(): string {
  if (app.isPackaged)
    return path.join(process.resourcesPath, 'viewer')
  const pkg = require.resolve('@kinora/trace-viewer/package.json')
  return path.join(path.dirname(pkg), 'dist')
}
function resolveHomeDir(): string {
  if (app.isPackaged)
    return path.join(process.resourcesPath, 'home')
  return path.join(__dirname, '../home/dist')
}

function ensureViewerWindow(): BrowserWindow {
  if (!viewerWin || viewerWin.isDestroyed()) {
    viewerWin = new BrowserWindow({
      width: 1280,
      height: 860,
      show: false,
      backgroundColor: '#0a0a0b',
      webPreferences: { contextIsolation: true, nodeIntegration: false, preload: path.join(__dirname, 'preload.cjs') },
    })
    viewerWin.once('ready-to-show', () => {
      if (!VIEWER_PROBE)
        viewerWin?.show()
    })
    viewerWin.webContents.on('console-message', ({ level, message }) => console.log(`[viewer:${level}] ${message}`))
    viewerWin.on('closed', () => {
      viewerWin = null
    })
  }
  else {
    viewerWin.focus()
  }
  return viewerWin
}

function loadViewer(traceParam: string | null): void {
  const base = `http://127.0.0.1:${port}/trace/index.html`
  const url = traceParam ? `${base}?trace=${encodeURIComponent(traceParam)}` : base
  void ensureViewerWindow().loadURL(url)
}

// Local file: served through the loopback /file route.
function openViewer(absPath: string | null): void {
  loadViewer(absPath ? `http://127.0.0.1:${port}/file?path=${encodeURIComponent(absPath)}` : null)
}

// Hosted artifact: the absolute URL is passed straight to the viewer's zip reader.
function openViewerUrl(traceUrl: string): void {
  loadViewer(traceUrl)
}

function createHomeWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1100,
    height: 760,
    show: false,
    backgroundColor: '#0a0a0b',
    // Integrated title bar on macOS (traffic lights inset over our themed header).
    // Other platforms keep native controls ('hidden' there would drop the close button).
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    // Vertically center the traffic lights in the 48px (h-12) header.
    trafficLightPosition: { x: 18, y: 17 },
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'home-preload.cjs'),
      // Sandboxed preload reads this from process.argv to expose window.kinora.isDev.
      // Suppressed during screenshot capture so website shots look like a prod build.
      additionalArguments: [`--kinora-dev=${app.isPackaged || process.env.KINORA_SHOT ? '0' : '1'}`],
    },
  })
  // Show only once painted so there's no blank white flash before the app renders.
  // Also show during capture: a hidden window's capturePage renders at 1x, not retina.
  win.once('ready-to-show', () => {
    if (!HOME_PROBE || process.env.KINORA_SHOT)
      win.show()
  })
  win.webContents.on('console-message', ({ level, message }) => console.log(`[home:${level}] ${message}`))
  void win.loadURL(`http://127.0.0.1:${port}/home/index.html`)
  return win
}

function registerIpc(): void {
  ipcMain.handle('kinora:session', async () => {
    if (!config.token)
      return { loggedIn: false, user: null }
    try {
      const me = await makeTrpc(config.serverUrl, config.token, config.webOrigin).user.me.query()
      if (!me)
        return { loggedIn: false, user: null }
      return { loggedIn: true, user: { name: me.name, email: me.email, image: me.image ?? null } }
    }
    catch {
      return { loggedIn: false, user: null }
    }
  })

  ipcMain.handle('kinora:open-account', () => shell.openExternal(`${config.webOrigin}/settings/account`))

  // Device flow: open the system browser to approve (no embedded webview, so all providers
  // work), then poll for the access token. The user code is surfaced to the renderer.
  ipcMain.handle('kinora:login-device', async () => {
    const abort = new AbortController()
    deviceAbort = abort
    try {
      const code = await requestDeviceCode(config.serverUrl)
      homeWin?.webContents.send('kinora:device-pending', { userCode: code.user_code, verificationUri: code.verification_uri })
      await shell.openExternal(code.verification_uri_complete)
      const token = await pollDeviceToken(config.serverUrl, code.device_code, code.interval ?? 5, abort.signal)
      if (abort.signal.aborted)
        return { ok: false, error: 'cancelled' }
      if (!token)
        return { ok: false, error: 'Device authorization failed or timed out' }
      config = { ...config, token }
      saveConfig(config)
      return { ok: true }
    }
    catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Device login failed' }
    }
    finally {
      if (deviceAbort === abort)
        deviceAbort = null
    }
  })

  ipcMain.handle('kinora:cancel-device-login', () => deviceAbort?.abort())

  ipcMain.handle('kinora:logout', () => {
    config = { ...config, token: null }
    saveConfig(config)
  })

  ipcMain.handle('kinora:projects', async () => {
    if (!config.token)
      return []
    const trpc = makeTrpc(config.serverUrl, config.token, config.webOrigin)
    const manifest = await trpc.dashboard.manifest.query()
    return manifest.projects
  })

  ipcMain.handle('kinora:run', async (_e, input: { projectId: string, runId: string }) => {
    if (!config.token)
      throw new Error('Not signed in')
    const trpc = makeTrpc(config.serverUrl, config.token, config.webOrigin)
    return trpc.dashboard.run.query(input)
  })

  ipcMain.handle('kinora:project-history', async (_e, input: { projectId: string }) => {
    if (!config.token)
      return []
    const trpc = makeTrpc(config.serverUrl, config.token, config.webOrigin)
    const history = await trpc.dashboard.projectHistory.query(input)
    return history.histories
  })

  ipcMain.handle('kinora:open-trace-url', (_e, traceUrl: string) => openViewerUrl(traceUrl))

  ipcMain.handle('kinora:open-local-trace', async () => {
    const res = await dialog.showOpenDialog(homeWin ?? undefined as never, {
      title: 'Open Playwright trace',
      properties: ['openFile'],
      filters: [{ name: 'Playwright trace', extensions: ['zip'] }],
    })
    if (!res.canceled && res.filePaths[0])
      openViewer(res.filePaths[0])
  })

  ipcMain.handle('kinora:project-paths', () => config.projectPaths)

  ipcMain.handle('kinora:set-project-path', async (_e, projectId: string) => {
    const res = await dialog.showOpenDialog(homeWin ?? undefined as never, {
      title: 'Select the local repo for this project',
      properties: ['openDirectory'],
    })
    if (res.canceled || !res.filePaths[0])
      return null
    const dir = res.filePaths[0]
    config = { ...config, projectPaths: { ...config.projectPaths, [projectId]: dir } }
    saveConfig(config)
    return dir
  })

  ipcMain.handle('kinora:open-in-editor', async (_e, input: { projectId: string, file: string, line: number, column: number }) => {
    const root = config.projectPaths[input.projectId]
    if (!root)
      return { ok: false, error: 'no-path' }
    const found = resolveTest(root, input.file)
    if (!found)
      return { ok: false, error: `Couldn't find ${input.file} under ${root}` }
    try {
      await openInEditor(found.absFile, input.line, input.column)
      return { ok: true }
    }
    catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Could not open editor' }
    }
  })

  ipcMain.handle('kinora:rerun-test', (_e, input: RerunInput) => {
    if (!config.projectPaths[input.projectId])
      return { ok: false, error: 'no-path' }
    lastRerunInput = input
    launchRerun(input)
    return { ok: true }
  })

  // Watch the test's playwright project and auto re-run on save.
  ipcMain.handle('kinora:set-watch', (_e, enabled: boolean) => {
    rerunWatchStop?.()
    rerunWatchStop = null
    const root = lastRerunInput && config.projectPaths[lastRerunInput.projectId]
    const found = root && lastRerunInput ? resolveTest(root, lastRerunInput.file) : null
    if (enabled && found)
      rerunWatchStop = watchRepo(found.configDir, () => lastRerunInput && launchRerun(lastRerunInput))
  })

  ipcMain.handle('kinora:fix-test', async (_e, input: FixTestIpcInput) => {
    const root = config.projectPaths[input.projectId]
    if (!root)
      return { ok: false, error: 'no-path' }
    const found = resolveTest(root, input.file)
    if (!found)
      return { ok: false, error: `Couldn't find ${input.file} under ${root}` }
    await launchAgentFix(found.configDir, found.absFile, input)
    return { ok: true }
  })

  // Red re-run after a fix: resume the same agent session with the failure output.
  ipcMain.handle('kinora:retry-agent-fix', (_e, input: { output: string }) => {
    if (!agentSession)
      return { ok: false, error: 'No agent session to retry' }
    // Keep the tail: that's where the assertion failure and summary live.
    const feedback = input.output.length > 20_000 ? input.output.slice(-20_000) : input.output
    runAgentTurn(agentSession, buildRetryPrompt(feedback))
    return { ok: true }
  })

  // Free-form user instruction to the same agent session ("also update the snapshot").
  ipcMain.handle('kinora:follow-up-agent-fix', (_e, input: { message: string }) => {
    if (!agentSession)
      return { ok: false, error: 'No agent session to continue' }
    runAgentTurn(agentSession, buildFollowUpPrompt(input.message.slice(0, 4_000)))
    return { ok: true }
  })

  ipcMain.handle('kinora:cancel-agent-fix', () => agentChild?.kill())

  ipcMain.handle('kinora:revert-agent-fix', async () => {
    if (!agentSession?.snap || !agentSession.changes.length)
      return { ok: false, error: 'Nothing to revert' }
    try {
      await revertAgentChanges(agentSession.snap, agentSession.changes)
      // The session's edits are gone; resuming it would build on state that no longer exists.
      agentSession = null
      return { ok: true }
    }
    catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Revert failed' }
    }
  })

  ipcMain.handle('kinora:cancel-rerun', () => rerunChild?.kill())
  ipcMain.handle('kinora:open-rerun-trace', () => {
    if (lastRerunTrace)
      openViewer(lastRerunTrace)
  })

  ipcMain.handle('kinora:restart-to-update', () => autoUpdater.quitAndInstall())
}

interface RerunInput { projectId: string, file: string, line: number, projectName?: string }
interface FixTestIpcInput extends RerunInput { title: string, status: string, errors: string, traceUrl?: string }

// The home window may be gone (closed while a viewer window keeps the app alive).
function sendHome(channel: string, payload?: unknown): void {
  if (homeWin && !homeWin.isDestroyed())
    homeWin.webContents.send(channel, payload)
}

function launchRerun(input: RerunInput): void {
  const root = config.projectPaths[input.projectId]
  if (!root)
    return
  const gen = ++rerunGen
  rerunChild?.kill()
  lastRerunTrace = null
  sendHome('kinora:rerun-started')
  const found = resolveTest(root, input.file)
  if (!found) {
    sendHome('kinora:rerun-output', `Couldn't find ${input.file} under ${root}\n`)
    sendHome('kinora:rerun-done', { ok: false, code: -1, hasTrace: false })
    return
  }
  const outDir = path.join(app.getPath('temp'), `kinora-rerun-${Date.now()}`)
  rerunChild = startRerun(
    { repoRoot: found.configDir, file: found.rel, line: input.line, projectName: input.projectName, outDir },
    (chunk) => {
      if (gen === rerunGen)
        sendHome('kinora:rerun-output', chunk)
    },
    (r) => {
      if (gen !== rerunGen)
        return
      rerunChild = null
      lastRerunTrace = r.tracePath
      sendHome('kinora:rerun-done', { ok: r.ok, code: r.code, hasTrace: !!r.tracePath })
    },
  )
}

// Start a fresh agent-fix session: snapshot git state once (Revert always restores to
// this point, across retries), enrich the prompt with the trace's error-context, run
// the first turn. One agent at a time: a new launch kills the old.
async function launchAgentFix(configDir: string, absFile: string, input: FixTestIpcInput): Promise<void> {
  const gen = ++agentGen
  agentChild?.kill()
  const snap = await gitSnapshot(configDir)
  if (!snap)
    sendHome('kinora:agent-output', 'Not a git repo: changes can\'t be reviewed or reverted here.\n')
  // Best-effort: a missing/unreachable trace just means a leaner prompt.
  let errorContext: string | null = null
  if (input.traceUrl) {
    sendHome('kinora:agent-output', '▸ fetching page snapshot from the trace…\n')
    errorContext = await fetchErrorContext(input.traceUrl)
    if (gen !== agentGen)
      return
    if (!errorContext)
      sendHome('kinora:agent-output', '▸ no error context in the trace, continuing without it\n')
  }
  agentSession = { configDir, absFile, input, snap, sessionId: null, changes: [], errorContext }
  runAgentTurn(agentSession, null)
}

// One agent turn: the opening fix attempt, or (with a resume prompt + session id) a
// retry / user follow-up. Diff always accumulates against the session's snapshot.
function runAgentTurn(session: AgentSession, resumePrompt: string | null): void {
  const gen = ++agentGen
  agentChild?.kill()
  const { input } = session
  agentChild = startAgentFix(
    session.configDir,
    { title: input.title, absFile: session.absFile, line: input.line, projectName: input.projectName, status: input.status, errors: input.errors, errorContext: session.errorContext },
    (chunk) => {
      if (gen === agentGen)
        sendHome('kinora:agent-output', chunk)
    },
    (r) => {
      if (gen !== agentGen)
        return
      agentChild = null
      session.sessionId = r.sessionId ?? session.sessionId
      void (async () => {
        let diff = ''
        if (session.snap) {
          try {
            ({ diff, changes: session.changes } = await collectAgentDiff(session.snap))
          }
          catch (err) {
            sendHome('kinora:agent-output', `Couldn't collect the diff: ${err instanceof Error ? err.message : err}\n`)
          }
        }
        if (gen === agentGen)
          sendHome('kinora:agent-done', { ok: r.ok, error: r.error, diff, files: session.changes.map(c => c.path), hadDirty: !!session.snap && session.snap.dirty.size > 0, costUsd: r.costUsd, durationMs: r.durationMs })
      })()
    },
    resumePrompt && session.sessionId ? { resumeSessionId: session.sessionId, resumePrompt } : {},
  )
}

async function main(): Promise<void> {
  // Re-read now that the app is ready: safeStorage only works post-ready, so the
  // module-load loadConfig() above can't decrypt the saved token.
  config = loadConfig()
  const started = await startServer({ viewerDir: resolveViewerDir(), homeDir: resolveHomeDir() })
  port = started.port
  registerIpc()

  // Viewer probe: open a trace window and assert it renders. With no trace to
  // open the viewer shows its drop zone, so the probe names the bundled demo
  // fixture rather than relying on an implicit default.
  if (VIEWER_PROBE) {
    const trace = PROBE_TRACE || pendingOpen || argvTrace()
    if (trace)
      openViewer(trace)
    else
      openViewerUrl(`http://127.0.0.1:${port}/trace/fixtures/demo.zip`)
    await probeViewer()
    return
  }

  // Home probe: log in with env creds, then assert the project list renders.
  if (HOME_PROBE) {
    config = { ...config, serverUrl: process.env.KINORA_SERVER || config.serverUrl, webOrigin: process.env.KINORA_WEB_ORIGIN || config.webOrigin }
    const token = await signIn(config.serverUrl, config.webOrigin, process.env.KINORA_EMAIL || 'demo@kinora.dev', process.env.KINORA_PASSWORD || 'password123')
    config = { ...config, token }
    homeWin = createHomeWindow()
    await probeHome()
    return
  }

  // Device-flow probe: request a code, simulate the browser approval (sign in + approve),
  // then poll for the access token. Validates the full server-side device grant headless.
  if (DEVICE_PROBE) {
    config = { ...config, serverUrl: process.env.KINORA_SERVER || config.serverUrl, webOrigin: process.env.KINORA_WEB_ORIGIN || config.webOrigin }
    const ok = await probeDevice()
    console.log(`[probe] ${ok ? 'PASS' : 'FAIL'}`)
    app.exit(ok ? 0 : 1)
    return
  }

  homeWin = createHomeWindow()
  homeWin.on('closed', () => {
    homeWin = null
  })
  buildMenu({ win: homeWin, onOpen: openViewer })

  // Auto-update from GitHub Releases. Downloads in the background and surfaces an
  // in-app "Restart to update" pill when ready; installs on quit either way.
  // Packaged only: dev/probe builds have no published feed.
  if (app.isPackaged) {
    autoUpdater.on('error', err => console.error('[updater]', err))
    autoUpdater.on('update-downloaded', () => sendHome('kinora:update-ready'))
    void autoUpdater.checkForUpdates()
    // Long-running sessions: re-check periodically so users who never restart still update.
    setInterval(() => void autoUpdater.checkForUpdates(), 6 * 60 * 60 * 1000)
  }

  // A trace passed at launch opens straight in the viewer.
  const launchTrace = pendingOpen || argvTrace()
  if (launchTrace)
    openViewer(launchTrace)
}

async function probeViewer(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 6000)
  })
  const v = await viewerWin!.webContents.executeJavaScript(`(() => {
    const text = document.body.innerText || ''
    return { sw: !!(navigator.serviceWorker && navigator.serviceWorker.controller), err: text.includes('Failed to load trace'), actions: text.includes('ACTIONS') }
  })()`) as { sw: boolean, err: boolean, actions: boolean }
  const ok = v.sw && !v.err && v.actions
  console.log(`[probe] viewer ${JSON.stringify(v)}`)
  console.log(`[probe] ${ok ? 'PASS' : 'FAIL'}`)
  app.exit(ok ? 0 : 1)
}

async function probeHome(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 5000)
  })
  const v = await homeWin!.webContents.executeJavaScript(`(() => {
    const text = document.body.innerText || ''
    return { failuresView: text.includes('latest run'), body: text.slice(0, 160).replace(/\\s+/g, ' ').trim() }
  })()`) as { failuresView: boolean, body: string }
  if (process.env.KINORA_SHOT) {
    const proj = process.env.KINORA_SHOT_PROJECT
    const theme = process.env.KINORA_SHOT_THEME
    if (proj || theme) {
      await homeWin!.webContents.executeJavaScript(
        `${proj ? `localStorage.setItem('kinora-desktop-project', ${JSON.stringify(proj)});` : ''}${theme ? `localStorage.setItem('kinora-theme', ${JSON.stringify(theme)});` : ''}`,
      )
      await homeWin!.webContents.reload()
      await new Promise<void>(resolve => setTimeout(resolve, 4000))
    }
    if (process.env.KINORA_SHOT_FILTER) {
      await homeWin!.webContents.executeJavaScript(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(process.env.KINORA_SHOT_FILTER)})?.click()`)
      await new Promise<void>(resolve => setTimeout(resolve, 600))
    }
    const img = await homeWin!.webContents.capturePage()
    const { writeFileSync } = await import('node:fs')
    writeFileSync(process.env.KINORA_SHOT, img.toPNG())
  }
  const ok = v.failuresView
  console.log(`[probe] home ${JSON.stringify(v)}`)
  console.log(`[probe] ${ok ? 'PASS' : 'FAIL'}`)
  app.exit(ok ? 0 : 1)
}

async function probeDevice(): Promise<boolean> {
  const code = await requestDeviceCode(config.serverUrl)
  console.log(`[probe] device/code user_code=${code.user_code}`)
  // Simulate the browser approval: sign in for a session token, then approve the user code.
  const token = await signIn(config.serverUrl, config.webOrigin, process.env.KINORA_EMAIL || 'demo@kinora.dev', process.env.KINORA_PASSWORD || 'password123')
  const approve = await fetch(`${config.serverUrl}/api/auth/device/approve`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}`, 'Origin': config.webOrigin },
    body: JSON.stringify({ userCode: code.user_code }),
  })
  console.log(`[probe] device/approve status=${approve.status}`)
  const accessToken = await pollDeviceToken(config.serverUrl, code.device_code, 1)
  console.log(`[probe] device access_token=${accessToken ? 'yes' : 'no'}`)
  return !!accessToken
}

app.whenReady().then(main).catch((err: unknown) => {
  console.error('[desktop] fatal', err)
  app.exit(1)
})

app.on('window-all-closed', () => app.quit())
