// Exposed by the desktop app's viewer preload; absent on the web.
export interface DesktopBridge {
  openInEditor?: (file: string, line: number, column: number) => Promise<{ error?: string }>
}

export function desktopBridge(): DesktopBridge | undefined {
  return (window as { __kinoraDesktop?: DesktopBridge }).__kinoraDesktop
}

// VS Code's `vscode://file/<absolute path>:line:column` handler; Windows paths keep their drive letter.
export function vscodeUrl(file: string, line: number, column = 1): string {
  const path = file.replace(/\\/g, '/')
  return `vscode://file${path.startsWith('/') ? '' : '/'}${encodeURI(path)}:${line}:${column}`
}
