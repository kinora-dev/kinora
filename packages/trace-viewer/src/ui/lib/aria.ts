import type { AriaNodeJSON, AriaSnapshotJSON } from '@isomorphic/ariaSnapshot'
import { renderAriaSnapshotAsYaml } from '@isomorphic/ariaSnapshotRenderer'

export type AriaTokenKind = 'role' | 'string' | 'attribute'

export interface AriaToken {
  kind?: AriaTokenKind
  text: string
}

export interface AriaBox { x: number, y: number, width: number, height: number }

export interface AriaLine {
  box?: AriaBox
  text: string
}

// Trace ARIA snapshots are JSON since Playwright 1.63; anything else is shown as recorded.
export function ariaSnapshotLines(raw: string): AriaLine[] {
  let snapshot: unknown
  try {
    snapshot = JSON.parse(raw)
  }
  catch {}
  if (!Array.isArray(snapshot))
    return raw.trimEnd().split('\n').map(text => ({ text }))

  // Boxes move to the lines (rendered, they would read `[box=x,y,w,h]`), in page coordinates.
  const boxes = new Map<AriaNodeJSON, AriaBox>()
  const extractBoxes = (node: AriaNodeJSON | string, offset: { x: number, y: number }): void => {
    if (typeof node === 'string')
      return
    if (node.box)
      boxes.set(node, { ...node.box, x: node.box.x + offset.x, y: node.box.y + offset.y })
    const childOffset = node.role === 'iframe' && node.box ? { x: offset.x + node.box.x, y: offset.y + node.box.y } : offset
    for (const child of node.children ?? [])
      extractBoxes(child, childOffset)
    delete node.box
  }
  for (const node of snapshot as AriaSnapshotJSON)
    extractBoxes(node, { x: 0, y: 0 })

  const lineToNode = new Map<number, AriaNodeJSON>()
  const text = renderAriaSnapshotAsYaml(snapshot as AriaSnapshotJSON, { lineToNode })
  return text.trimEnd().split('\n').map((line, index) => {
    const node = lineToNode.get(index)
    return { box: node ? boxes.get(node) : undefined, text: line }
  })
}

const tokenRegex = /("(?:[^"\\]|\\.)*")|(\/(?:[^/\\]|\\.)*\/)|(\[[^\]]*\])/g

// Same colouring rules as upstream `ariaModeView.tsx`: role, quoted strings / regexes, [attributes].
export function ariaLineTokens(line: string): AriaToken[] {
  const tokens: AriaToken[] = []
  const roleMatch = line.match(/^(\s*- )([\w-]+)/)
  let rest = line
  if (roleMatch) {
    tokens.push({ text: roleMatch[1] }, { kind: 'role', text: roleMatch[2] })
    rest = line.slice(roleMatch[0].length)
  }
  let lastIndex = 0
  for (const match of rest.matchAll(tokenRegex)) {
    if (match.index > lastIndex)
      tokens.push({ text: rest.slice(lastIndex, match.index) })
    tokens.push({ kind: match[3] ? 'attribute' : 'string', text: match[0] })
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < rest.length)
    tokens.push({ text: rest.slice(lastIndex) })
  return tokens
}
