// Runs the visual tests against a browser inside the official Playwright Docker image, so
// screenshots are rendered by the same Linux build everywhere: a laptop, CI, anyone's machine.
// Only the browser lives in the container; the test runner and the gallery stay on the host.
//
//   node scripts/visual.mjs                      run the visual project
//   node scripts/visual.mjs --update-snapshots   regenerate the reference images
//
// Any other argument is handed to `playwright test` (pass --project yourself to override).
import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { connect } from 'node:net'
import process from 'node:process'

const require = createRequire(import.meta.url)
// The server in the container must be the exact Playwright version the tests run with.
const { version } = require('@playwright/test/package.json')

const IMAGE = `mcr.microsoft.com/playwright:v${version}-noble`
const NAME = 'kinora-ui-visual'
const PORT = 53980

function docker(...args) {
  return spawnSync('docker', args, { encoding: 'utf8' })
}

function portOpen() {
  return new Promise((resolve) => {
    const socket = connect(PORT, '127.0.0.1')
    socket.once('connect', () => resolve(socket.destroy() && true))
    socket.once('error', () => resolve(false))
  })
}

async function waitForServer() {
  for (let attempt = 0; attempt < 240; attempt++) {
    // The port is published as soon as the container starts; the log line means it is serving.
    if (await portOpen() && docker('logs', NAME).stdout.includes('Listening on'))
      return
    if (docker('inspect', '-f', '{{.State.Running}}', NAME).stdout.trim() !== 'true')
      throw new Error(`the browser container stopped:\n${docker('logs', NAME).stderr}`)
    await new Promise(resolve => setTimeout(resolve, 500))
  }
  throw new Error('the browser container did not start listening in time')
}

if (docker('version', '--format', '{{.Server.Version}}').status !== 0) {
  console.error('Visual tests need Docker running: screenshots are rendered inside the Playwright image.')
  process.exit(1)
}

docker('rm', '-f', NAME)
execFileSync('docker', [
  'run',
  '--rm',
  '--detach',
  '--name',
  NAME,
  '--ipc=host',
  // Lets the browser reach the gallery served on the host (built in on Docker Desktop).
  '--add-host=host.docker.internal:host-gateway',
  '--publish',
  `127.0.0.1:${PORT}:${PORT}`,
  IMAGE,
  'npx',
  '--yes',
  `playwright@${version}`,
  'run-server',
  '--port',
  String(PORT),
  '--host',
  '0.0.0.0',
], { stdio: ['ignore', 'ignore', 'inherit'] })

let code = 1
try {
  await waitForServer()
  const args = process.argv.slice(2)
  const project = args.some(arg => arg.startsWith('--project')) ? [] : ['--project=visual']
  const run = spawn('pnpm', ['exec', 'playwright', 'test', ...project, ...args], {
    stdio: 'inherit',
    env: { ...process.env, PW_TEST_CONNECT_WS_ENDPOINT: `ws://127.0.0.1:${PORT}/`, KINORA_VISUAL: '1' },
  })
  code = await new Promise(resolve => run.once('exit', status => resolve(status ?? 1)))
}
finally {
  docker('rm', '-f', NAME)
}
process.exit(code)
