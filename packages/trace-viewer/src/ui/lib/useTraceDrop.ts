import type { Ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import { onMounted, ref } from 'vue'
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

  // Pasting a trace zip opens it, like upstream.
  useEventListener(document, 'paste', (e: ClipboardEvent) => {
    const files = [...(e.clipboardData?.files ?? [])]
    if (!files.length || !files.every(isZip))
      return
    e.preventDefault()
    void store.loadFile(files[0])
  })

  // Embedding API, same as upstream: a parent or opener posts `{ method: 'load', params: { trace: Blob } }`
  // and hears `{ method: 'ready' }` once the viewer can open it.
  useEventListener(window, 'message', (e: MessageEvent) => {
    const { method, params } = e.data ?? {}
    if (method === 'load' && params?.trace instanceof Blob)
      void store.loadFile(new File([params.trace], 'trace.zip', { type: 'application/zip' }))
  })
  // Like upstream, only once the service worker controls the page: the reload a fresh install may
  // need would drop a trace posted earlier, since a `blob:` trace does not survive it.
  onMounted(async () => {
    try {
      await store.ensureServiceWorker()
    }
    catch {
      return
    }
    window.opener?.postMessage({ method: 'ready' }, '*')
    if (window.parent !== window)
      window.parent.postMessage({ method: 'ready' }, '*')
  })

  return { isDragging }
}

const ZIP_TYPES = ['application/zip', 'application/x-zip-compressed']

function isZip(file: File): boolean {
  return ZIP_TYPES.includes(file.type) || file.name.toLowerCase().endsWith('.zip')
}
