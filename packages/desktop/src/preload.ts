import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Drag-drop a .zip onto the window -> open it. Electron 35 removed File.path,
// so resolve the on-disk path via webUtils.getPathForFile. DOM events are shared
// with the page, so listeners added from this isolated preload still fire.
window.addEventListener('dragover', (e) => {
  e.preventDefault()
})

window.addEventListener('drop', (e) => {
  e.preventDefault()
  const file = e.dataTransfer?.files?.[0]
  if (!file)
    return
  const p = webUtils.getPathForFile(file)
  if (p && p.toLowerCase().endsWith('.zip'))
    ipcRenderer.send('kinora:open-trace', p)
})

// `ready` lets the headless probe confirm the preload loaded; the viewer's Source tab
// feature-detects `openInEditor`.
contextBridge.exposeInMainWorld('__kinoraDesktop', {
  ready: true,
  openInEditor: (file: string, line: number, column: number) => ipcRenderer.invoke('kinora:viewer-open-in-editor', { file, line, column }),
})
