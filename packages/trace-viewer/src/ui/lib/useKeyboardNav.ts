import { useActiveElement, useMagicKeys, whenever } from '@vueuse/core'
import { useTraceStore } from '../store'

export function useKeyboardNav(): void {
  const store = useTraceStore()
  const active = useActiveElement()

  function typing(): boolean {
    const el = active.value as HTMLElement | null
    return !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
  }

  // Left/Right/Enter also drive tabs and buttons, so the tree only takes them from the list itself.
  function inActionList(): boolean {
    const el = active.value as HTMLElement | null
    return !el || el === document.body || !!el.closest('[data-action-list]')
  }

  const keys = useMagicKeys()
  const next = (): void => {
    if (!typing())
      store.step(1)
  }
  const prev = (): void => {
    if (!typing())
      store.step(-1)
  }

  whenever(keys.ArrowDown!, next)
  whenever(keys.j!, next)
  whenever(keys.ArrowUp!, prev)
  whenever(keys.k!, prev)
  whenever(keys.ArrowLeft!, () => {
    if (!typing() && inActionList())
      store.collapseOrParent()
  })
  whenever(keys.ArrowRight!, () => {
    if (!typing() && inActionList())
      store.expandOrChild()
  })
  // Enter zooms the timeline to the selected action, like double-click (upstream's "accept").
  whenever(keys.Enter!, () => {
    if (!typing() && inActionList() && store.selectedAction.value)
      store.zoomToAction(store.selectedAction.value)
  })
}
