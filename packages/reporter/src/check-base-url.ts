import type { FullConfig, FullProject } from '@playwright/test'
import process from 'node:process'

// A Playwright global setup that stops the run before any worker starts when the app under test
// does not answer: no CI time spent on an outage, and no run of failures uploaded to kinora.
//   globalSetup: ['@kinora/reporter/check-base-url', './global-setup']
// List it after a setup that starts the app. KINORA_CHECK_BASE_URL=false skips it.

export const CHECK_ATTEMPTS = 3
export const CHECK_TIMEOUT_MS = 10_000
export const CHECK_DELAY_MS = 2_000

// What a gateway answers when the app behind it is down. Any other status is the app answering.
const GATEWAY_DOWN: Record<number, string> = { 502: 'bad gateway', 503: 'service unavailable', 504: 'gateway timeout' }

type Project = Pick<FullProject, 'name' | 'dependencies' | 'use'>

export interface BaseUrlTarget {
  url: string
  projects: string[]
  ignoreHTTPSErrors: boolean
  proxy?: FullProject['use']['proxy']
  // The browser runs on another machine, which may reach the URL from another network.
  remoteBrowser: boolean
}

export type ProbeOutcome = { status: number } | { error: string }
export type Probe = (target: BaseUrlTarget, timeoutMs: number) => Promise<ProbeOutcome>

export interface CheckOptions {
  attempts?: number
  timeoutMs?: number
  delayMs?: number
  probe?: Probe
  argv?: string[]
  env?: Record<string, string | undefined>
}

// `--project` names on the command line (`--project=a`, `--project a b`), or null for every project.
function cliProjects(argv: string[]): string[] | null {
  let names: string[] | null = null
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--project=')) {
      (names ??= []).push(argv[i].slice('--project='.length))
    }
    else if (argv[i] === '--project') {
      while (argv[i + 1] && !argv[i + 1].startsWith('-')) (names ??= []).push(argv[++i])
    }
  }
  return names
}

const wildcard = (pattern: string) => new RegExp(`^${pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i')

// The projects this run executes: Playwright's own selection (1.64+), else the command line's,
// plus the projects they depend on unless `--no-deps`.
export function selectedProjects<P extends Project>(projects: P[], filtered: Project[] | undefined, argv: string[]): P[] {
  let chosen: Set<P>
  if (filtered) {
    const names = new Set(filtered.map(p => p.name))
    chosen = new Set(projects.filter(p => filtered.includes(p) || names.has(p.name)))
  }
  else {
    const names = cliProjects(argv)
    if (!names?.length)
      return projects
    const patterns = names.map(wildcard)
    chosen = new Set(projects.filter(p => patterns.some(re => re.test(p.name))))
  }
  if (!argv.includes('--no-deps')) {
    const byName = new Map(projects.map(p => [p.name, p]))
    const queue = [...chosen]
    while (queue.length) {
      for (const dep of queue.shift()!.dependencies) {
        const p = byName.get(dep)
        if (p && !chosen.has(p)) {
          chosen.add(p)
          queue.push(p)
        }
      }
    }
  }
  return projects.filter(p => chosen.has(p))
}

export function baseUrlTargets(
  config: Pick<FullConfig, 'projects'> & { filteredProjects?: Project[] },
  argv: string[] = process.argv,
  env: Record<string, string | undefined> = process.env,
): BaseUrlTarget[] {
  const targets = new Map<string, BaseUrlTarget>()
  for (const project of selectedProjects(config.projects, config.filteredProjects, argv)) {
    const url = project.use.baseURL
    if (!url || !/^https?:\/\//i.test(url))
      continue
    const remoteBrowser = !!project.use.connectOptions || !!env.PW_TEST_CONNECT_WS_ENDPOINT
    const target = targets.get(url)
    if (target) {
      if (project.name)
        target.projects.push(project.name)
      target.remoteBrowser ||= remoteBrowser
      continue
    }
    targets.set(url, {
      url,
      projects: project.name ? [project.name] : [],
      ignoreHTTPSErrors: !!project.use.ignoreHTTPSErrors,
      proxy: project.use.proxy,
      remoteBrowser,
    })
  }
  return [...targets.values()]
}

// Through Playwright's request context, with the project's proxy and HTTPS settings: the URL is
// reached the way the tests reach it.
const playwrightProbe: Probe = async (target, timeoutMs) => {
  const { request } = await import('@playwright/test')
  const context = await request.newContext({ ignoreHTTPSErrors: target.ignoreHTTPSErrors, proxy: target.proxy })
  try {
    const response = await context.get(target.url, { timeout: timeoutMs, maxRedirects: 0, failOnStatusCode: false })
    return { status: response.status() }
  }
  catch (error) {
    const first = (error instanceof Error ? error.message : String(error)).split('\n')[0].trim()
    return { error: first.replace(/^apiRequestContext\.\w+:\s*/, '') }
  }
  finally {
    await context.dispose().catch(() => {})
  }
}

// Why the URL counts as down after every attempt, or null as soon as it answers.
export async function checkBaseUrl(target: BaseUrlTarget, options: CheckOptions = {}): Promise<string | null> {
  const attempts = Math.max(1, options.attempts ?? CHECK_ATTEMPTS)
  const probe = options.probe ?? playwrightProbe
  let reason = ''
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const outcome = await probe(target, options.timeoutMs ?? CHECK_TIMEOUT_MS)
    if ('status' in outcome) {
      const down = GATEWAY_DOWN[outcome.status]
      if (!down)
        return null
      reason = `${outcome.status} ${down}`
    }
    else {
      reason = outcome.error
    }
    if (attempt < attempts)
      await new Promise(resolve => setTimeout(resolve, options.delayMs ?? CHECK_DELAY_MS))
  }
  return `${reason} (${attempts} ${attempts === 1 ? 'attempt' : 'attempts'})`
}

// Throws an error naming every base URL that did not answer, which fails the run before its tests.
export async function checkBaseUrls(config: Pick<FullConfig, 'projects'> & { filteredProjects?: Project[] }, options: CheckOptions = {}): Promise<void> {
  const env = options.env ?? process.env
  if (env.KINORA_CHECK_BASE_URL === 'false')
    return
  const targets = baseUrlTargets(config, options.argv, env)
  const reasons = await Promise.all(targets.map(t => checkBaseUrl(t, options)))
  const down = targets.flatMap((t, i) => reasons[i] ? [{ t, reason: reasons[i] }] : [])
  if (!down.length)
    return
  const message = [
    '[kinora] The app under test did not answer, so no test ran:',
    ...down.map(({ t, reason }) => `  ${t.url}${t.projects.length ? ` (${t.projects.join(', ')})` : ''}: ${reason}${t.remoteBrowser
      ? `\n    The check ran from this machine, but the browser runs on another one and may reach ${new URL(t.url).host} from its own network.`
      : ''}`),
    'Bring the environment back and run again, or set KINORA_CHECK_BASE_URL=false to run the tests anyway.',
  ].join('\n')
  const error = new Error(message)
  // Playwright prints the stack of a failed global setup; the message says everything.
  error.stack = message
  throw error
}

export default async function globalSetup(config: FullConfig): Promise<void> {
  await checkBaseUrls(config)
}
