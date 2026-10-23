import { onBeforeUnmount, ref, watch } from 'vue'
import { useTraceStore } from '../store'
import { locatorForElement, locatorInFrames, uniqueSelector } from './locator'

export function useLocatorPicker() {
  const store = useTraceStore()
  const iframe = ref<HTMLIFrameElement | null>(null)
  let cleanups: (() => void)[] = []

  function setIframe(el: HTMLIFrameElement | null): void {
    iframe.value = el
  }

  function uninstall(): void {
    for (const cleanup of cleanups)
      cleanup()
    cleanups = []
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && store.inspectingLocator.value) {
      event.preventDefault()
      store.setInspectingLocator(false)
    }
  }

  // `frames` holds the selectors of the iframes leading to `doc`, outermost first.
  function installInDocument(doc: Document, frames: string[]): void {
    if (!doc.body)
      return
    const testIdName = store.model.value?.testIdAttributeName ?? 'data-testid'
    const previousCursor = doc.body.style.cursor
    doc.body.style.cursor = 'crosshair'

    const overlay = doc.createElement('div')
    overlay.dataset.kinoraInspectorOverlay = 'true'
    Object.assign(overlay.style, {
      position: 'fixed',
      display: 'none',
      pointerEvents: 'none',
      zIndex: '2147483647',
      border: '2px solid #f59e0b',
      background: 'rgba(245, 158, 11, 0.14)',
      borderRadius: '3px',
      boxSizing: 'border-box',
    })
    doc.body.append(overlay)

    function targetFor(event: MouseEvent): Element | null {
      const target = doc.elementFromPoint(event.clientX, event.clientY)
      // A nested iframe gets its own picker, so its element is never the pick.
      if (!target || target === overlay || target.closest('[data-kinora-inspector-overlay]') || target.tagName === 'IFRAME')
        return null
      return target
    }

    function onMove(event: MouseEvent): void {
      const target = targetFor(event)
      if (!target) {
        overlay.style.display = 'none'
        return
      }
      const rect = target.getBoundingClientRect()
      Object.assign(overlay.style, {
        display: 'block',
        left: `${rect.left}px`,
        top: `${rect.top}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`,
      })
    }

    function onLeave(): void {
      overlay.style.display = 'none'
    }

    function onClick(event: MouseEvent): void {
      const target = targetFor(event)
      if (!target)
        return
      event.preventDefault()
      event.stopPropagation()
      store.pickLocator(locatorInFrames(locatorForElement(target, testIdName), frames))
    }

    doc.addEventListener('mousemove', onMove, true)
    doc.addEventListener('mouseleave', onLeave, true)
    doc.addEventListener('click', onClick, true)
    doc.addEventListener('keydown', onKeyDown, true)
    cleanups.push(() => {
      doc.removeEventListener('mousemove', onMove, true)
      doc.removeEventListener('mouseleave', onLeave, true)
      doc.removeEventListener('click', onClick, true)
      doc.removeEventListener('keydown', onKeyDown, true)
      doc.body.style.cursor = previousCursor
      overlay.remove()
    })

    // Snapshot iframes are same-origin; their documents can load after the parent's.
    for (const child of doc.querySelectorAll('iframe')) {
      const childFrames = [...frames, uniqueSelector(child, testIdName)]
      const installChild = (): void => {
        try {
          if (child.contentDocument)
            installInDocument(child.contentDocument, childFrames)
        }
        catch {
          // Cross-origin frame: nothing to pick inside.
        }
      }
      installChild()
      child.addEventListener('load', installChild)
      cleanups.push(() => child.removeEventListener('load', installChild))
    }
  }

  function installInspector(): void {
    uninstall()
    const doc = iframe.value?.contentDocument
    if (!store.inspectingLocator.value || !doc)
      return
    installInDocument(doc, [])
    window.addEventListener('keydown', onKeyDown)
    cleanups.push(() => window.removeEventListener('keydown', onKeyDown))
  }

  watch([() => store.inspectingLocator.value, iframe], installInspector)

  onBeforeUnmount(uninstall)

  return { setIframe }
}
