const ANSI_RE = new RegExp(`${String.fromCharCode(0x1B)}\\[[0-9;]*m`, 'g')

export function stripAnsi(value: string): string {
  return value.replace(ANSI_RE, '')
}
