import type { AttachmentKind } from '@kinora/core'

const ATTACHMENT_KINDS: AttachmentKind[] = ['trace', 'video', 'screenshot', 'snapshot']

// Throws instead of exiting so the bin owns the usage output; undefined = flag absent (keep the default).
export function parseAttachmentKinds(raw: string | undefined): AttachmentKind[] | undefined {
  if (raw === undefined)
    return undefined

  const kinds = raw.split(',').map(k => k.trim()).filter(Boolean)
  const unknown = kinds.filter(k => !ATTACHMENT_KINDS.includes(k as AttachmentKind))
  if (unknown.length)
    throw new Error(`unknown --upload-attachments value: ${unknown.join(', ')} (allowed: ${ATTACHMENT_KINDS.join(', ')})`)

  return kinds as AttachmentKind[]
}
