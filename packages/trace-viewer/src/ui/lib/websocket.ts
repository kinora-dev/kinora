import type { WebSocketMessage } from '@isomorphic/trace/versions/har'

// Helpers ported from upstream's WebSocket messages tab (networkResourceDetails.tsx).

export interface IndexedMessage extends WebSocketMessage {
  index: number
  byteLength: number
}

// Traces store the frames as a JSON-lines body; HAR files embed them on the entry.
export function parseMessages(embedded: WebSocketMessage[] | undefined, jsonl: string | undefined): IndexedMessage[] {
  const messages = embedded ?? (jsonl ?? '').split('\n').filter(Boolean).map(line => JSON.parse(line) as WebSocketMessage)
  return messages.map((m, index) => ({ ...m, index, byteLength: messageByteLength(m) }))
}

export function opcodeName(opcode: number): string {
  switch (opcode) {
    case 0: return 'Continuation'
    case 1: return 'Text'
    case 2: return 'Binary'
    case 8: return 'Close'
    case 9: return 'Ping'
    case 10: return 'Pong'
    default: return `Opcode ${opcode}`
  }
}

export function base64ByteLength(data: string): number {
  if (!data)
    return 0
  const padding = data.endsWith('==') ? 2 : data.endsWith('=') ? 1 : 0
  return Math.max(0, Math.floor(data.length * 3 / 4) - padding)
}

// Text frames carry text; every other opcode carries base64.
export function messageByteLength(message: WebSocketMessage): number {
  return message.opcode === 1 ? new TextEncoder().encode(message.data).length : base64ByteLength(message.data)
}

export function messagePreview(message: WebSocketMessage, size: (bytes: number) => string): string {
  if (message.opcode === 1) {
    const trimmed = message.data.replace(/\s+/g, ' ')
    return trimmed.length > 200 ? `${trimmed.substring(0, 200)}…` : trimmed
  }
  if (message.opcode === 8)
    return '(close)'
  if (message.opcode === 9)
    return '(ping)'
  if (message.opcode === 10)
    return '(pong)'
  return `(binary, ${size(base64ByteLength(message.data))})`
}

export function decodeBase64ToText(base64: string): string {
  const binary = atob(base64)
  const bytes = Uint8Array.from(binary, c => c.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: false }).decode(bytes)
}

export function dumpHex(base64: string): string {
  if (!base64)
    return ''
  const binary = atob(base64)
  const lines: string[] = []
  for (let offset = 0; offset < binary.length; offset += 16) {
    const chunkLength = Math.min(16, binary.length - offset)
    const hex: string[] = []
    const ascii: string[] = []
    for (let i = 0; i < 16; ++i) {
      if (i < chunkLength) {
        const code = binary.charCodeAt(offset + i)
        hex.push(code.toString(16).padStart(2, '0'))
        ascii.push(code >= 0x20 && code < 0x7F ? binary[offset + i] : '.')
      }
      else {
        hex.push('  ')
      }
      if (i === 7)
        hex.push('')
    }
    lines.push(`${offset.toString(16).padStart(8, '0')}  ${hex.join(' ')}  ${ascii.join('')}`)
  }
  return lines.join('\n')
}

// What the detail pane shows: text as is (JSON when it parses), control payloads decoded, binary as a hex dump.
export function messageBody(message: WebSocketMessage): { text: string, mime: string } {
  if (message.opcode === 1) {
    try {
      JSON.parse(message.data)
      return { text: message.data, mime: 'application/json' }
    }
    catch {
      return { text: message.data, mime: 'text/plain' }
    }
  }
  if (message.opcode === 8 || message.opcode === 9 || message.opcode === 10) {
    if (!message.data)
      return { text: '', mime: 'text/plain' }
    try {
      return { text: decodeBase64ToText(message.data), mime: 'text/plain' }
    }
    catch {
      return { text: dumpHex(message.data), mime: 'text/plain' }
    }
  }
  return { text: dumpHex(message.data), mime: 'text/plain' }
}
