import type { ErrorDescription, TraceModel } from '@isomorphic/trace/traceModel'

// One entry per message, like upstream: a retried assertion reports the same error several times.
export function uniqueErrors(model: Pick<TraceModel, 'errorDescriptors'> | null | undefined): ErrorDescription[] {
  const byMessage = new Map<string, ErrorDescription>()
  for (const error of model?.errorDescriptors ?? [])
    byMessage.set(error.message, error)
  return [...byMessage.values()]
}

// `file:line` of the frame the error points at, short and full.
export function errorLocation(error: ErrorDescription): { short: string, full: string } | undefined {
  const frame = error.stack?.[0] ?? error.action?.stack?.[0]
  if (!frame)
    return undefined
  const file = frame.file.split(/[/\\]/).pop() ?? frame.file
  return { short: `${file}:${frame.line}`, full: `${frame.file}:${frame.line}` }
}
