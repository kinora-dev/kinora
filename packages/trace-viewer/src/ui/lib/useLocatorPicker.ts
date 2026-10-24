import type { InjectedScript } from '@injected/injectedScript'
import type { Recorder } from '@injected/recorder/recorder'
import type { Language } from '@isomorphic/locatorGenerators'
import type { ElementInfo } from '@recorder/recorderTypes'
import { asLocator } from '@isomorphic/locatorGenerators'
import { locatorOrSelectorAsSelector } from '@isomorphic/locatorParser'
import { onBeforeUnmount, ref, watch } from 'vue'
import { useTraceStore } from '../store'
import { parseAriaTemplate } from './ariaTemplate'
import { selectorForFrame } from './locatorMatch'

interface FrameRecorder {
  recorder: Recorder
  // Selector of the iframes leading to this frame, ending with `>> internal:control=enter-frame >>`.
  frameSelector: string
}

type RecordedWindow = Window & typeof globalThis & { _kinoraRecorder?: FrameRecorder, _kinoraInjectedScript?: InjectedScript }

// The injected script only matters once picking starts, so it stays out of the initial bundle.
type InjectedModules = [typeof import('@injected/injectedScript'), typeof import('@injected/recorder/recorder')]
let injectedModules: Promise<InjectedModules> | undefined
// Called while the trace loads, so the picker is ready by the time someone clicks Pick.
export function loadInjected(): Promise<InjectedModules> {
  injectedModules ??= Promise.all([import('@injected/injectedScript'), import('@injected/recorder/recorder')])
  return injectedModules
}

// Like upstream, `?isUnderTest` opens the highlight's shadow root so e2e tests can see it.
const isUnderTest = new URLSearchParams(globalThis.location?.search ?? '').has('isUnderTest')

// `playwright.$`, `playwright.generateLocator`... in the console of a popped-out snapshot.
// Upstream installs it from the opener onto its snapshot.html wrapper; kinora loads it inside the
// snapshot itself, so it queries the snapshot document and runs in its realm. The snapshot's CSP
// only lets nonce'd scripts run, hence the page's own nonce on the injected <script>.
export async function installConsoleApi(win: Window, options: { sdkLanguage: Language, testIdAttributeName: string }): Promise<void> {
  const src = new URL('console-api.bundle.js', location.href).toString()
  // The tab starts on about:blank and gets the snapshot asynchronously; give it ten seconds.
  for (let attempt = 0; attempt < 200 && !win.closed; attempt++) {
    try {
      const doc = win.document
      if (win.location.href !== 'about:blank' && doc.readyState !== 'loading') {
        const script = doc.createElement('script')
        script.nonce = doc.querySelector<HTMLScriptElement>('script[nonce]')?.nonce ?? ''
        script.src = src
        Object.assign(script.dataset, { ...options, isUnderTest: String(isUnderTest) })
        doc.head.append(script)
        return
      }
    }
    catch {
      // Navigation in progress.
    }
    await new Promise(resolve => setTimeout(resolve, 50))
  }
}

// One injected script + recorder per snapshot frame, like upstream's `createRecorders` (snapshotTab.tsx).
// They live on the frame's window, so a new snapshot document gets fresh ones.
function createRecorders(modules: InjectedModules, out: FrameRecorder[], options: { sdkLanguage: Language, testIdAttributeName: string }, frameSelector: string, win: Window | null | undefined): void {
  const [{ InjectedScript }, { Recorder }] = modules
  if (!win)
    return
  const frame = win as RecordedWindow
  if (!frame._kinoraRecorder) {
    const injectedScript = new InjectedScript(frame, { isUnderTest, frameSeq: 0, stableRafCount: 1, browserName: 'chromium', customEngines: [], ...options })
    frame._kinoraInjectedScript = injectedScript
    // Kinora's snapshot toolbar has its own Pick button, so the recorder's in-page toolbar stays hidden.
    frame._kinoraRecorder = { recorder: new Recorder(injectedScript, { hideToolbar: true }), frameSelector }
  }
  out.push(frame._kinoraRecorder)
  for (let i = 0; i < frame.frames.length; ++i) {
    const child = frame.frames[i]
    try {
      const childSelector = child.frameElement
        ? `${frame._kinoraInjectedScript!.generateSelectorSimple(child.frameElement, { omitInternalEngines: true, testIdAttributeName: options.testIdAttributeName })} >> internal:control=enter-frame >> `
        : ''
      createRecorders(modules, out, options, frameSelector + childSelector, child)
    }
    catch {
      // Cross-origin frame: nothing to pick inside.
    }
  }
}

export function useLocatorPicker() {
  const store = useTraceStore()
  const iframe = ref<HTMLIFrameElement | null>(null)
  let recorders: FrameRecorder[] = []
  let documents: Document[] = []

  function setIframe(el: HTMLIFrameElement | null): void {
    iframe.value = el
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && store.inspectingLocator.value) {
      event.preventDefault()
      store.setInspectingLocator(false)
    }
  }

  function stopListening(): void {
    for (const doc of documents)
      doc.removeEventListener('keydown', onKeyDown, true)
    documents = []
  }

  let updates = 0
  async function update(): Promise<void> {
    const current = ++updates
    const inspecting = store.inspectingLocator.value
    const query = store.snapshotQuery.value?.text.trim() ? store.snapshotQuery.value : null
    // Recorders are created lazily: picking, or a query to resolve against the snapshot.
    const [modules, template] = await Promise.all([
      inspecting || query ? loadInjected() : undefined,
      query?.kind === 'aria' ? parseAriaTemplate(query.text) : undefined,
    ])
    if (current !== updates)
      return
    const sdkLanguage = store.model.value?.sdkLanguage ?? 'javascript'
    const testIdAttributeName = store.model.value?.testIdAttributeName ?? 'data-testid'
    const uiState = { mode: inspecting ? 'inspecting' as const : 'none' as const, language: sdkLanguage, testIdAttributeName, overlay: { offsetX: 0 } }
    const found: FrameRecorder[] = []
    try {
      if (modules)
        createRecorders(modules, found, { sdkLanguage, testIdAttributeName }, '', iframe.value?.contentWindow)
    }
    catch {
      // The snapshot document may be gone mid-swap.
    }
    for (const previous of recorders) {
      if (!found.includes(previous)) {
        previous.recorder.injectedScript.setHighlights([])
        previous.recorder.setUIState({ ...uiState, mode: 'none' }, {})
      }
    }
    recorders = found
    stopListening()

    // Same resolution as upstream's InspectModeController, plus a match count. A locator is split
    // across frames; an ARIA template is tried as is in every frame.
    const fullSelector = !query
      ? ''
      : query.kind === 'aria' ? template?.selector ?? '' : locatorOrSelectorAsSelector(sdkLanguage, query.text, testIdAttributeName)
    let matches = 0
    for (const { recorder, frameSelector } of recorders) {
      const selector = !fullSelector ? undefined : query?.kind === 'aria' ? fullSelector : selectorForFrame(fullSelector, frameSelector)
      try {
        const parsed = selector ? recorder.injectedScript.parseSelector(selector) : undefined
        recorder.injectedScript.setHighlights(parsed ? [{ selector: parsed }] : [])
        if (parsed)
          matches += recorder.injectedScript.querySelectorAll(parsed, recorder.document).length
      }
      catch {
        // Not resolvable in this frame (e.g. the part that enters a child frame).
        recorder.injectedScript.setHighlights([])
      }
    }
    store.queryMatches.value = !query ? null : fullSelector ? matches : 'invalid'

    for (const { recorder, frameSelector } of recorders) {
      recorder.setUIState(uiState, {
        async elementPicked(elementInfo: ElementInfo) {
          const selector = frameSelector + elementInfo.selector
          store.pickLocator({ selector, locator: asLocator(sdkLanguage, selector), ariaSnapshot: elementInfo.ariaSnapshot })
        },
        highlightUpdated() {
          for (const other of recorders) {
            if (other.recorder !== recorder)
              other.recorder.clearHighlight()
          }
        },
      })
      recorder.document.addEventListener('keydown', onKeyDown, true)
      documents.push(recorder.document)
    }
  }

  watch([() => store.inspectingLocator.value, () => store.snapshotQuery.value, iframe], () => void update())
  window.addEventListener('keydown', onKeyDown)
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    stopListening()
  })

  return { setIframe }
}
