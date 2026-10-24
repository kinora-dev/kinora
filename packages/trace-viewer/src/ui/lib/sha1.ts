// Source files are stored in the trace under the SHA-1 of their path (`src/<sha1><ext>`).
export async function calculateSha1(text: string): Promise<string> {
  const buffer = new TextEncoder().encode(text)
  const hash = await crypto.subtle.digest('SHA-1', buffer)
  const view = new DataView(hash)
  const hex: string[] = []
  for (let i = 0; i < view.byteLength; i += 1)
    hex.push(view.getUint8(i).toString(16).padStart(2, '0'))
  return hex.join('')
}
