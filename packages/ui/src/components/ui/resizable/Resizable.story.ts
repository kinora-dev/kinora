import { h } from 'vue'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '.'

// The trace viewer's layout in miniature: a bounded side panel next to the main one.
export function TwoPanels() {
  return h('div', { class: 'h-40 w-[600px] border' }, [
    h(ResizablePanelGroup, { direction: 'horizontal' }, () => [
      h(ResizablePanel, { defaultSize: 30, minSize: 20, maxSize: 50 }, () => h('div', { 'data-testid': 'actions' }, 'Actions')),
      h(ResizableHandle, { withHandle: true }),
      h(ResizablePanel, { defaultSize: 70 }, () => h('div', { 'data-testid': 'snapshot' }, 'Snapshot')),
    ]),
  ])
}
