import { describe, expect, it } from 'vitest'
import { base64ByteLength, dumpHex, messageBody, messagePreview, opcodeName, parseMessages } from '../src/ui/lib/websocket'

const size = (bytes: number) => `${bytes} B`

describe('parseMessages', () => {
  it('reads JSON lines and indexes them with their byte length', () => {
    const jsonl = '{"type":"send","time":1,"opcode":1,"data":"héllo"}\n{"type":"receive","time":2,"opcode":2,"data":"yv66vgAB"}\n'
    expect(parseMessages(undefined, jsonl)).toEqual([
      { type: 'send', time: 1, opcode: 1, data: 'héllo', index: 0, byteLength: 6 },
      { type: 'receive', time: 2, opcode: 2, data: 'yv66vgAB', index: 1, byteLength: 6 },
    ])
  })

  it('prefers messages embedded in the HAR entry', () => {
    expect(parseMessages([{ type: 'send', time: 1, opcode: 1, data: 'a' }], 'ignored')).toHaveLength(1)
  })
})

describe('frames', () => {
  it('names opcodes and previews control and binary frames', () => {
    expect(opcodeName(1)).toBe('Text')
    expect(opcodeName(42)).toBe('Opcode 42')
    expect(messagePreview({ type: 'receive', time: 0, opcode: 9, data: '' }, size)).toBe('(ping)')
    expect(messagePreview({ type: 'receive', time: 0, opcode: 2, data: 'yv66vgAB' }, size)).toBe('(binary, 6 B)')
    expect(base64ByteLength('YQ==')).toBe(1)
  })

  it('shows text as JSON when it parses, binary as a hex dump', () => {
    expect(messageBody({ type: 'send', time: 0, opcode: 1, data: '{"a":1}' }).mime).toBe('application/json')
    expect(messageBody({ type: 'send', time: 0, opcode: 1, data: 'hi' }).mime).toBe('text/plain')
    expect(dumpHex('yv66vgAB')).toMatch(/^00000000 {2}ca fe ba be 00 01 +\.{6}$/)
    expect(messageBody({ type: 'receive', time: 0, opcode: 8, data: btoa('bye') }).text).toBe('bye')
  })
})
