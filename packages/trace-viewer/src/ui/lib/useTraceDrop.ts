import type { Ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { ref } from 'vue'
import { useTraceStore } from '../store'

// Window-level drag & drop so a trace can be dropped anywhere, not just on the
// empty state: dropping over a loaded workbench swaps the trace.
export function useTraceDrop(): { isDragging: Ref<boolean> } {
  const store = useTraceStore()
  const isDragging = ref(false)
  // dragenter/dragleave fire per element crossed, so count them instead of
  // toggling; otherwise the overlay flickers as the pointer moves over children.
  let depth = 0

  const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer?.types.includes('Files')

  useEventListener(window, 'dragenter', (e: DragEvent) => {
    if (!hasFiles(e))
      return
    depth++
    isDragging.value = true
  })

  useEventListener(window, 'dragleave', () => {
    depth = Math.max(0, depth - 1)
    if (!depth)
      isDragging.value = false
  })

  // Without preventDefault on dragover the browser never fires drop.
  useEventListener(window, 'dragover', (e: DragEvent) => {
    if (hasFiles(e))
      e.preventDefault()
  })

  useEventListener(window, 'drop', (e: DragEvent) => {
    const file = e.dataTransfer?.files?.[0]
    depth = 0
    isDragging.value = false
    if (!file)
      return
    // Otherwise the browser navigates to the dropped file.
    e.preventDefault()
    void store.loadFile(file)
  })

  return { isDragging }
}
