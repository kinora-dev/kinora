import { useEventListener } from '@vueuse/core'
import { useTraceStore } from '../store'

const NAV_SCOPE = '[data-action-list], [data-timeline]'

export function useKeyboardNav(): void {
  const store = useTraceStore()
  // Whether the user last interacted with the action list or timeline (or nothing yet). Clicking a
  // non-focusable row elsewhere (network, console) leaves focus on <body>, so focus alone can't tell.
  let inScope = true

  function track(event: Event): void {
    const target = event.target as Element | null
    inScope = !target || target === document.body || target === document.documentElement || !!target.closest?.(NAV_SCOPE)
  }
  useEventListener(document, 'pointerdown', track, { capture: true })
  useEventListener(document, 'focusin', track, { capture: true })

  function typing(el: Element | null): boolean {
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el as HTMLElement).isContentEditable)
  }

  // Left/Right/Enter also drive tabs and buttons, so the tree only takes them from the list itself.
  function inActionList(el: Element | null): boolean {
    return !el || el === document.body || !!el.closest('[data-action-list]')
  }

  useEventListener(document, 'keydown', (event: KeyboardEvent) => {
    const active = document.activeElement
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || !inScope || typing(active))
      return
    let handled = true
    switch (event.key) {
      case 'ArrowDown':
      case 'j':
        store.step(1)
        break
      case 'ArrowUp':
      case 'k':
        store.step(-1)
        break
      case 'ArrowLeft':
        if (inActionList(active))
          store.collapseOrParent()
        else
          handled = false
        break
      case 'ArrowRight':
        if (inActionList(active))
          store.expandOrChild()
        else
          handled = false
        break
      // Enter zooms the timeline to the selected action, like double-click (upstream's "accept").
      case 'Enter':
        if (inActionList(active) && store.selectedAction.value)
          store.zoomToAction(store.selectedAction.value)
        else
          handled = false
        break
      default:
        handled = false
    }
    // The list scrolls to the selection itself; the browser must not scroll it a second time.
    if (handled)
      event.preventDefault()
  })
}
