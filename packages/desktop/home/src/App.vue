<script setup lang="ts">
import type { Project, RunReport, SessionUser, TestHistory } from '../../src/bridge'
import { stripAnsi } from '@kinora/core'
import { Button } from '@kinora/ui/button'
import { Card, CardContent } from '@kinora/ui/card'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import AppHeader from './components/AppHeader.vue'
import Failures from './components/Failures.vue'

const STORE_KEY = 'kinora-desktop-project'

const view = ref<'loading' | 'login' | 'projects'>('loading')
const user = ref<SessionUser | null>(null)
const error = ref('')
const devicePending = ref(false)
const deviceCode = ref('')
const projects = ref<Project[]>([])
const activeId = ref<string | null>(null)
const report = ref<RunReport | null>(null)
const histories = ref<TestHistory[]>([])
const reportLoading = ref(false)
const projectPaths = ref<Record<string, string>>({})
const highlightLink = ref(false)
const rerun = ref<{ title: string, status: 'running' | 'passed' | 'failed' | 'error', log: string, hasTrace: boolean, watch: boolean } | null>(null)
interface AgentTarget { file: string, line: number, projectName: string, title: string }
// verify tracks the local re-run that checks the agent's fix: idle -> running -> passed/failed.
// costUsd/durationMs accumulate across turns (retries, follow-ups) of one session.
const agent = ref<{ target: AgentTarget, status: 'running' | 'done' | 'stopped' | 'error', verify: 'idle' | 'running' | 'passed' | 'failed', log: string, error: string, diff: string, files: string[], hadDirty: boolean, reverted: boolean, costUsd: number, durationMs: number } | null>(null)
const followUpText = ref('')
const logEl = ref<HTMLElement | null>(null)
const agentLogEl = ref<HTMLElement | null>(null)
const updateReady = ref(false)
const isDev = window.kinora.isDev

const rerunStatusText = computed(() => {
  const s = rerun.value?.status
  return s === 'running' ? 'Running…' : s === 'passed' ? 'Passed' : s === 'failed' ? 'Failed' : s === 'error' ? 'Error' : ''
})
const rerunStatusCls = computed(() => (rerun.value?.status === 'passed' ? 'text-pass' : rerun.value?.status === 'running' ? 'text-signal' : 'text-fail'))
// Strip the whole buffer (not per-chunk) so the line reporter's cursor codes (ESC[1A/[2K) go.
const rerunLog = computed(() => stripAnsi(rerun.value?.log ?? ''))

const agentLog = computed(() => stripAnsi(agent.value?.log ?? ''))
const agentStatusText = computed(() => {
  const s = agent.value?.status
  return s === 'running' ? 'Agent working…' : s === 'done' ? 'Agent done' : s === 'stopped' ? 'Agent stopped' : s === 'error' ? 'Agent error' : ''
})
const agentStatusCls = computed(() => (
  agent.value?.status === 'done'
    ? 'text-pass'
    : agent.value?.status === 'running'
      ? 'text-signal'
      : agent.value?.status === 'stopped' ? 'text-muted-foreground' : 'text-fail'
))
// Session spend + wall-clock ("$0.14 · 1m32s"), shown once a turn reported them.
const agentStats = computed(() => {
  const a = agent.value
  if (!a || (!a.costUsd && !a.durationMs))
    return ''
  const parts: string[] = []
  if (a.costUsd)
    parts.push(`$${a.costUsd.toFixed(2)}`)
  if (a.durationMs) {
    const s = Math.round(a.durationMs / 1000)
    parts.push(s >= 60 ? `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s` : `${s}s`)
  }
  return parts.join(' · ')
})

// Per-line classes so the proposed diff reads as a diff (adds green, removals red).
const agentDiffLines = computed(() => (agent.value?.diff ?? '').split('\n').map(text => ({
  text,
  cls: text.startsWith('+') && !text.startsWith('+++')
    ? 'text-pass'
    : text.startsWith('-') && !text.startsWith('---')
      ? 'text-fail'
      : text.startsWith('@@') || text.startsWith('diff ')
        ? 'text-signal'
        : 'text-muted-foreground',
})))

const activeProject = computed(() => projects.value.find(p => p.id === activeId.value) ?? null)
const activePath = computed(() => (activeId.value ? projectPaths.value[activeId.value] ?? null : null))

// Load the active project's latest run (the failures inbox renders from it).
async function loadActive(): Promise<void> {
  report.value = null
  histories.value = []
  const p = activeProject.value
  if (!p)
    return
  const latest = p.latestRun
  if (!latest)
    return
  reportLoading.value = true
  try {
    const [run, hist] = await Promise.all([
      window.kinora.run({ projectId: p.id, runId: latest.runId }),
      window.kinora.projectHistory({ projectId: p.id }),
    ])
    report.value = run
    histories.value = hist
  }
  finally {
    reportLoading.value = false
  }
}

async function refresh(): Promise<void> {
  const s = await window.kinora.session()
  if (!s.loggedIn) {
    view.value = 'login'
    return
  }
  user.value = s.user
  projects.value = await window.kinora.projects()
  projectPaths.value = await window.kinora.projectPaths()
  const stored = localStorage.getItem(STORE_KEY)
  activeId.value = projects.value.find(p => p.id === stored)?.id ?? projects.value[0]?.id ?? null
  view.value = 'projects'
  await loadActive()
}

onMounted(refresh)

// Pause the decorative pulse while the window is backgrounded so an idle app does no compositing.
function syncWindowFocus(): void {
  document.documentElement.classList.toggle('win-blurred', !document.hasFocus())
}
onMounted(syncWindowFocus)
window.addEventListener('focus', syncWindowFocus)
window.addEventListener('blur', syncWindowFocus)

window.kinora.onDevicePending((info) => {
  deviceCode.value = info.userCode
})

window.kinora.onUpdateReady(() => {
  updateReady.value = true
})

// A re-run of the agent's own target test (auto, manual, or watch-triggered) doubles
// as the verification of the fix.
function rerunVerifiesAgent(): boolean {
  return !!agent.value && !!rerun.value && rerun.value.title === agent.value.target.title
    && agent.value.status !== 'running' && !agent.value.reverted
}

window.kinora.onRerunStarted(() => {
  if (rerun.value) {
    rerun.value.status = 'running'
    rerun.value.log = ''
    rerun.value.hasTrace = false
  }
  if (rerunVerifiesAgent())
    agent.value!.verify = 'running'
})
window.kinora.onRerunOutput((chunk) => {
  if (rerun.value)
    rerun.value.log += chunk
})
window.kinora.onRerunDone((r) => {
  if (!rerun.value)
    return
  rerun.value.status = r.code === -1 ? 'error' : r.ok ? 'passed' : 'failed'
  rerun.value.hasTrace = r.hasTrace
  if (rerunVerifiesAgent())
    agent.value!.verify = r.ok ? 'passed' : 'failed'
})

window.kinora.onAgentOutput((chunk) => {
  if (agent.value)
    agent.value.log += chunk
})
window.kinora.onAgentDone((r) => {
  if (!agent.value)
    return
  // A stopped agent still reports the diff of whatever it edited before the kill,
  // so partial changes get reviewed (and are revertable) instead of lingering silently.
  agent.value.status = r.ok ? 'done' : r.error === 'cancelled' ? 'stopped' : 'error'
  agent.value.error = r.error && r.error !== 'cancelled' ? r.error : ''
  agent.value.diff = r.diff
  agent.value.files = r.files
  agent.value.hadDirty = r.hadDirty
  agent.value.costUsd += r.costUsd ?? 0
  agent.value.durationMs += r.durationMs ?? 0
  // Close the loop: a successful turn that changed files gets verified by a re-run.
  if (agent.value.status === 'done' && agent.value.files.length && !agent.value.reverted) {
    agent.value.verify = 'running'
    void onRerun(agent.value.target)
  }
})

// Tail the live log to the latest output.
watch(() => rerun.value?.log, () => {
  void nextTick(() => {
    if (logEl.value)
      logEl.value.scrollTop = logEl.value.scrollHeight
  })
})
watch(() => agent.value?.log, () => {
  void nextTick(() => {
    if (agentLogEl.value)
      agentLogEl.value.scrollTop = agentLogEl.value.scrollHeight
  })
})

function selectProject(id: string): void {
  // The re-run/watch and agent sessions are tied to a test in the current project; end them on switch.
  if (rerun.value)
    closeRerun()
  if (agent.value)
    closeAgent()
  activeId.value = id
  localStorage.setItem(STORE_KEY, id)
  void loadActive()
}

async function onDeviceLogin(): Promise<void> {
  error.value = ''
  deviceCode.value = ''
  devicePending.value = true
  const res = await window.kinora.loginWithDevice()
  devicePending.value = false
  if (res.ok)
    await refresh()
  else if (res.error && res.error !== 'cancelled')
    error.value = res.error
}

function onCancelDevice(): void {
  void window.kinora.cancelDeviceLogin()
  devicePending.value = false
  deviceCode.value = ''
}

async function onLogout(): Promise<void> {
  await window.kinora.logout()
  projects.value = []
  activeId.value = null
  report.value = null
  user.value = null
  view.value = 'login'
}

function openTrace(): void {
  void window.kinora.openLocalTrace()
}

function openAccount(): void {
  void window.kinora.openAccount()
}

function restartToUpdate(): void {
  void window.kinora.restartToUpdate()
}

function onViewTrace(traceUrl: string): void {
  void window.kinora.openTraceUrl(traceUrl)
}

let linkPulseTimer: ReturnType<typeof setTimeout> | undefined
// A disabled Re-run/Open was clicked: flash the header's "Link folder" to guide the user.
function onRequestLink(): void {
  highlightLink.value = true
  clearTimeout(linkPulseTimer)
  linkPulseTimer = setTimeout(() => {
    highlightLink.value = false
  }, 1800)
}

async function linkActiveProject(): Promise<string | null> {
  const id = activeId.value
  if (!id)
    return null
  const dir = await window.kinora.setProjectPath(id)
  if (dir)
    projectPaths.value = { ...projectPaths.value, [id]: dir }
  return dir
}

async function onOpenInEditor(loc: { file: string, line: number, column: number }): Promise<void> {
  const id = activeId.value
  if (!id)
    return
  // First open prompts to link the local repo; cancel = no-op.
  if (!projectPaths.value[id] && !(await linkActiveProject()))
    return
  const res = await window.kinora.openInEditor({ projectId: id, ...loc })
  if (!res.ok && res.error && res.error !== 'no-path')
    error.value = res.error
}

async function onRerun(t: { file: string, line: number, projectName: string, title: string }): Promise<void> {
  const id = activeId.value
  if (!id)
    return
  if (!projectPaths.value[id] && !(await linkActiveProject()))
    return
  rerun.value = { title: t.title, status: 'running', log: '', hasTrace: false, watch: false }
  const res = await window.kinora.rerunTest({ projectId: id, file: t.file, line: t.line, projectName: t.projectName })
  if (!res.ok && res.error && res.error !== 'no-path') {
    rerun.value.status = 'error'
    rerun.value.log = res.error
  }
}
async function onFixTest(t: { file: string, line: number, projectName: string, title: string, status: string, errors: string }): Promise<void> {
  const id = activeId.value
  if (!id)
    return
  if (!projectPaths.value[id] && !(await linkActiveProject()))
    return
  followUpText.value = ''
  agent.value = { target: { file: t.file, line: t.line, projectName: t.projectName, title: t.title }, status: 'running', verify: 'idle', log: '', error: '', diff: '', files: [], hadDirty: false, reverted: false, costUsd: 0, durationMs: 0 }
  const res = await window.kinora.fixTest({ projectId: id, ...t })
  if (!res.ok && res.error && res.error !== 'no-path') {
    agent.value.status = 'error'
    agent.value.error = res.error
  }
}
function stopAgent(): void {
  void window.kinora.cancelAgentFix()
}
function closeAgent(): void {
  void window.kinora.cancelAgentFix()
  agent.value = null
}
async function revertAgent(): Promise<void> {
  if (!agent.value)
    return
  const res = await window.kinora.revertAgentFix()
  if (res.ok) {
    agent.value.reverted = true
  }
  else if (res.error) {
    agent.value.error = res.error
  }
}
// The agent's proposal is verified by the existing local re-run loop.
function rerunAgentTarget(): void {
  if (agent.value)
    void onRerun(agent.value.target)
}
// Still red after the fix: resume the agent session with the re-run output as feedback.
async function retryAgent(): Promise<void> {
  if (!agent.value)
    return
  agent.value.status = 'running'
  agent.value.verify = 'idle'
  agent.value.log = ''
  agent.value.error = ''
  const res = await window.kinora.retryAgentFix({ output: rerunLog.value })
  if (!res.ok && res.error) {
    agent.value.status = 'error'
    agent.value.error = res.error
  }
}

// Free-form instruction to the same agent session, from the panel's input.
async function sendFollowUp(): Promise<void> {
  const message = followUpText.value.trim()
  if (!agent.value || !message || agent.value.status === 'running')
    return
  followUpText.value = ''
  agent.value.status = 'running'
  agent.value.verify = 'idle'
  agent.value.log = ''
  agent.value.error = ''
  const res = await window.kinora.followUpAgentFix({ message })
  if (!res.ok && res.error) {
    agent.value.status = 'error'
    agent.value.error = res.error
  }
}

function stopRerun(): void {
  void window.kinora.cancelRerun()
}
function toggleWatch(): void {
  if (!rerun.value)
    return
  rerun.value.watch = !rerun.value.watch
  void window.kinora.setWatch(rerun.value.watch)
}
function closeRerun(): void {
  void window.kinora.setWatch(false)
  void window.kinora.cancelRerun()
  rerun.value = null
}
function viewRerunTrace(): void {
  void window.kinora.openRerunTrace()
}
</script>

<template>
  <!-- login: single device flow (signs in via the system browser: github/google/email) -->
  <div v-if="view === 'login'" class="app-grid relative flex h-full flex-col items-center justify-center gap-7 bg-background p-6">
    <div class="app-drag absolute inset-x-0 top-0 h-10" />
    <div class="flex flex-col items-center gap-2 text-center">
      <div class="flex items-center gap-2.5">
        <span
          class="rec-dot size-2.5 rounded-full bg-signal"
          aria-hidden="true"
        />
        <span class="font-mono text-xl font-semibold tracking-tight lowercase">kinora</span>
        <span v-if="isDev" class="rounded border border-amber-400/40 bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-amber-400 uppercase">dev</span>
      </div>
      <span class="font-mono text-[10px] font-medium tracking-wider text-muted-foreground uppercase">desktop</span>
    </div>
    <Card class="w-full max-w-sm">
      <CardContent class="space-y-4">
        <p class="text-center text-sm text-muted-foreground">
          Sign in to your kinora account.
        </p>
        <div v-if="devicePending" class="space-y-2 text-center">
          <p class="text-xs text-muted-foreground">
            Approve in your browser. Confirm this code:
          </p>
          <p class="font-mono text-lg font-semibold tracking-[0.3em]">
            {{ deviceCode || '····' }}
          </p>
          <Button variant="ghost" size="sm" class="text-xs text-muted-foreground" @click="onCancelDevice">
            Cancel
          </Button>
        </div>
        <Button v-else class="w-full bg-signal text-white hover:bg-signal/90" @click="onDeviceLogin">
          Sign in with browser
        </Button>
        <p v-if="error" class="rounded-md border border-fail/30 bg-fail/10 px-3 py-2 text-xs text-fail">
          {{ error }}
        </p>
      </CardContent>
    </Card>
  </div>

  <!-- loading -->
  <div v-else-if="view === 'loading'" class="relative flex h-full items-center justify-center bg-background text-sm text-muted-foreground">
    <div class="app-drag absolute inset-x-0 top-0 h-10" />
    Loading…
  </div>

  <!-- dashboard: failures of the active project's latest run -->
  <div v-else class="app-grid flex h-full flex-col bg-background text-foreground">
    <AppHeader
      :projects="projects"
      :active-id="activeId"
      :user="user"
      :project-path="activePath"
      :highlight-link="highlightLink"
      :update-ready="updateReady"
      @select="selectProject"
      @open-trace="openTrace"
      @open-account="openAccount"
      @link-folder="linkActiveProject"
      @logout="onLogout"
      @restart-update="restartToUpdate"
    />

    <main class="w-full flex-1 overflow-auto">
      <div class="mx-auto w-full max-w-4xl px-5 py-8">
        <p v-if="projects.length === 0" class="py-16 text-center font-mono text-sm text-muted-foreground">
          No projects yet. Push a run from the reporter or CLI.
        </p>
        <Failures
          v-else-if="activeProject"
          :key="activeProject.id"
          :project="activeProject"
          :report="report"
          :histories="histories"
          :loading="reportLoading"
          :linked="!!activePath"
          @view-trace="onViewTrace"
          @open-in-editor="onOpenInEditor"
          @rerun="onRerun"
          @fix-test="onFixTest"
          @request-link="onRequestLink"
        />
      </div>
    </main>

    <!-- bottom dock: agent fix + local re-run panels stack when both are open -->
    <div v-if="rerun || agent" class="fixed inset-x-0 bottom-0 z-40 divide-y divide-border border-t border-border bg-background/95 backdrop-blur">
      <!-- agent fix: live agent output, then the proposed diff to keep/revert -->
      <div v-if="agent" class="mx-auto max-w-4xl px-5 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <span class="font-mono text-[11px] tracking-wider uppercase" :class="agentStatusCls">{{ agentStatusText }}</span>
            <span class="truncate text-sm">{{ agent.target.title }}</span>
            <span v-if="agent.reverted" class="shrink-0 font-mono text-[10px] text-muted-foreground">· reverted</span>
            <span v-else-if="agent.verify === 'running'" class="shrink-0 font-mono text-[10px] text-signal">· verifying…</span>
            <span v-else-if="agent.verify === 'passed'" class="shrink-0 font-mono text-[10px] text-pass">· fix verified, test passes</span>
            <span v-else-if="agent.verify === 'failed'" class="shrink-0 font-mono text-[10px] text-fail">· still failing</span>
            <span v-if="agentStats" class="shrink-0 font-mono text-[10px] text-muted-foreground">· {{ agentStats }}</span>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <Button v-if="agent.status === 'running'" variant="outline" size="sm" class="h-7 font-mono text-[11px]" @click="stopAgent">
              Stop
            </Button>
            <Button v-if="agent.verify === 'failed' && !agent.reverted" variant="outline" size="sm" class="h-7 gap-1.5 border-signal font-mono text-[11px] text-signal" title="Resume the agent with the re-run output" @click="retryAgent">
              Retry with output
            </Button>
            <Button v-if="agent.status !== 'running' && agent.files.length && !agent.reverted" variant="outline" size="sm" class="h-7 font-mono text-[11px]" @click="rerunAgentTarget">
              Re-run test
            </Button>
            <Button v-if="agent.status !== 'running' && agent.files.length && !agent.reverted" variant="outline" size="sm" class="h-7 font-mono text-[11px] text-fail" @click="revertAgent">
              Revert
            </Button>
            <!-- No Close while running: Stop first, review the partial diff, then decide. -->
            <Button v-if="agent.status !== 'running'" variant="ghost" size="sm" class="h-7 font-mono text-[11px] text-muted-foreground" @click="closeAgent">
              Close
            </Button>
          </div>
        </div>
        <p v-if="agent.error" class="mt-2 rounded-md border border-fail/30 bg-fail/10 px-3 py-2 font-mono text-[11px] text-fail">
          {{ agent.error }}
        </p>
        <pre v-if="agentLog" ref="agentLogEl" class="mt-2 max-h-40 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{{ agentLog }}</pre>
        <template v-if="agent.status !== 'running' && !agent.reverted">
          <p v-if="agent.hadDirty && agent.files.length" class="mt-2 font-mono text-[10px] text-muted-foreground">
            Your working tree already had uncommitted changes; the diff and Revert cover only the files the agent touched.
          </p>
          <p v-if="agent.status === 'done' && !agent.files.length" class="mt-2 font-mono text-[11px] text-muted-foreground">
            The agent finished without changing any files.
          </p>
          <pre v-if="agent.diff" class="mt-2 max-h-64 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed"><span v-for="(l, i) in agentDiffLines" :key="i" class="block whitespace-pre-wrap" :class="l.cls">{{ l.text }}</span></pre>
          <!-- follow-up: keep talking to the same agent session -->
          <form class="mt-2 flex gap-1.5" @submit.prevent="sendFollowUp">
            <input
              v-model="followUpText"
              type="text"
              placeholder="Ask the agent to adjust… (e.g. also update the snapshot)"
              class="h-7 min-w-0 flex-1 rounded-md border border-border bg-muted/40 px-2 font-mono text-[11px] placeholder:text-muted-foreground/60 focus:border-signal/50 focus:outline-none"
            >
            <Button type="submit" variant="outline" size="sm" class="h-7 font-mono text-[11px]" :disabled="!followUpText.trim()">
              Send
            </Button>
          </form>
        </template>
      </div>

      <!-- local re-run: live output + result -->
      <div v-if="rerun" class="mx-auto max-w-4xl px-5 py-3">
        <div class="flex items-center justify-between gap-3">
          <div class="flex min-w-0 items-center gap-2">
            <span class="font-mono text-[11px] tracking-wider uppercase" :class="rerunStatusCls">{{ rerunStatusText }}</span>
            <span class="truncate text-sm">{{ rerun.title }}</span>
            <span v-if="rerun.watch && rerun.status !== 'running'" class="shrink-0 font-mono text-[10px] text-muted-foreground">· watching for changes</span>
          </div>
          <div class="flex shrink-0 gap-1.5">
            <Button
              variant="outline"
              size="sm"
              class="h-7 font-mono text-[11px]"
              :class="rerun.watch ? 'border-signal text-signal' : ''"
              title="Auto re-run when you save a file"
              @click="toggleWatch"
            >
              {{ rerun.watch ? 'Watching' : 'Watch' }}
            </Button>
            <Button v-if="rerun.status === 'running'" variant="outline" size="sm" class="h-7 font-mono text-[11px]" @click="stopRerun">
              Stop
            </Button>
            <Button v-if="rerun.hasTrace" variant="outline" size="sm" class="h-7 font-mono text-[11px]" @click="viewRerunTrace">
              View trace
            </Button>
            <Button variant="ghost" size="sm" class="h-7 font-mono text-[11px] text-muted-foreground" @click="closeRerun">
              Close
            </Button>
          </div>
        </div>
        <pre ref="logEl" class="mt-2 max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">{{ rerunLog }}</pre>
      </div>
    </div>
  </div>
</template>
