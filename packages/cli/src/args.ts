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

// `--base-url` (repeatable, one per Playwright project), else KINORA_BASE_URL (comma-separated).
export function parseBaseUrls(flags: string[] | undefined, env: string | undefined): string[] | undefined {
  const urls = (flags?.length ? flags : env?.split(',') ?? []).map(u => u.trim()).filter(Boolean)
  const invalid = urls.filter(u => !URL.canParse(u) || !/^https?:$/.test(new URL(u).protocol))
  if (invalid.length)
    throw new Error(`invalid --base-url: ${invalid.join(', ')} (expected an http(s) URL)`)
  return urls.length ? urls : undefined
}
