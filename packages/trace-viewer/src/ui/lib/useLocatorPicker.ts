import type { InjectedScript } from '@injected/injectedScript'
import type { Recorder } from '@injected/recorder/recorder'
import type { Language } from '@isomorphic/locatorGenerators'
import type { ElementInfo } from '@recorder/recorderTypes'
import { asLocator } from '@isomorphic/locatorGenerators'
import { onBeforeUnmount, ref, watch } from 'vue'
import { useTraceStore } from '../store'

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

// One injected script + recorder per snapshot frame, like upstream's `createRecorders` (snapshotTab.tsx).
// They live on the frame's window, so a new snapshot document gets fresh ones.
function createRecorders(modules: InjectedModules, out: FrameRecorder[], options: { sdkLanguage: Language, testIdAttributeName: string }, frameSelector: string, win: Window | null | undefined): void {
  const [{ InjectedScript }, { Recorder }] = modules
  if (!win)
    return
  const frame = win as RecordedWindow
  if (!frame._kinoraRecorder) {
    const injectedScript = new InjectedScript(frame, { isUnderTest: false, frameSeq: 0, stableRafCount: 1, browserName: 'chromium', customEngines: [], ...options })
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
    const modules = inspecting ? await loadInjected() : undefined
    if (current !== updates)
      return
    const sdkLanguage = store.model.value?.sdkLanguage ?? 'javascript'
    const testIdAttributeName = store.model.value?.testIdAttributeName ?? 'data-testid'
    // Recorders are created lazily, the first time picking is turned on for a snapshot.
    const found: FrameRecorder[] = []
    try {
      if (modules)
        createRecorders(modules, found, { sdkLanguage, testIdAttributeName }, '', iframe.value?.contentWindow)
    }
    catch {
      // The snapshot document may be gone mid-swap.
    }
    for (const previous of recorders) {
      if (!found.includes(previous))
        previous.recorder.setUIState({ mode: 'none', language: sdkLanguage, testIdAttributeName, overlay: { offsetX: 0 } }, {})
    }
    recorders = found
    stopListening()
    for (const { recorder, frameSelector } of recorders) {
      recorder.setUIState({ mode: 'inspecting', language: sdkLanguage, testIdAttributeName, overlay: { offsetX: 0 } }, {
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

  watch([() => store.inspectingLocator.value, iframe], () => void update())
  window.addEventListener('keydown', onKeyDown)
  onBeforeUnmount(() => {
    window.removeEventListener('keydown', onKeyDown)
    stopListening()
  })

  return { setIframe }
}
