import type { AriaNodeJSON, AriaSnapshotJSON } from '@isomorphic/ariaSnapshot'
import { renderAriaSnapshotAsYaml } from '@isomorphic/ariaSnapshotRenderer'

export type AriaTokenKind = 'role' | 'string' | 'attribute'

export interface AriaToken {
  kind?: AriaTokenKind
  text: string
}

// Trace ARIA snapshots are JSON since Playwright 1.63; anything else is shown as recorded.
export function ariaSnapshotText(raw: string): string {
  let snapshot: unknown
  try {
    snapshot = JSON.parse(raw)
  }
  catch {
    return raw
  }
  if (!Array.isArray(snapshot))
    return raw
  return renderAriaSnapshotAsYaml((snapshot as AriaSnapshotJSON).map(withoutBoxes))
}

// Boxes would otherwise render as `[box=x,y,w,h]` on every line.
function withoutBoxes(node: AriaNodeJSON): AriaNodeJSON {
  const { box: _box, children, ...rest } = node
  return children
    ? { ...rest, children: children.map(child => typeof child === 'string' ? child : withoutBoxes(child)) }
    : rest
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
