import type { Fetcher } from '../lib/ssrf'
import type { AlertPayload } from './core'
import { safeFetch } from '../lib/ssrf'
import { incidentLine, incompleteLine, listTests } from './core'

export interface SlackPayload {
  text: string
}

export function buildSlackMessage(input: AlertPayload): SlackPayload {
  const { counts } = input
  const ok = counts.unexpected === 0
  const lines = [
    input.incident
      ? `⚠️ *${input.projectName}* environment incident${input.incident.host ? `: ${input.incident.host}` : ''}`
      : input.incomplete
        ? `${ok ? '⚠️' : '🔴'} *${input.projectName}* run incomplete`
        : `${ok ? '✅' : '🔴'} *${input.projectName}* run finished`,
    `${counts.expected} passed · ${counts.unexpected} failed · ${counts.flaky} flaky · ${counts.skipped} skipped`,
  ]
  if (input.incomplete)
    lines.push(`*${incompleteLine(input.incomplete)}*`)
  if (input.incident)
    lines.push(incidentLine(input.incident))
  if (input.newlyFailing.length)
    lines.push(`*Newly failing (${input.newlyFailing.length}):* ${listTests(input.newlyFailing, input.codeOwners)}`)
  if (input.newlyFlaky.length)
    lines.push(`*Newly flaky (${input.newlyFlaky.length}):* ${listTests(input.newlyFlaky, input.codeOwners)}`)
  lines.push(`<${input.runUrl}|View run>`)
  return { text: lines.join('\n') }
}

export async function sendSlack(
  webhookUrl: string,
  payload: SlackPayload,
  fetchImpl: Fetcher = safeFetch,
): Promise<void> {
  const res = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })
  if (!res.ok)
    throw new Error(`slack webhook responded ${res.status}`)
}
