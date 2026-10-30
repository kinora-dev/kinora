import type { AlertPayload } from './core'
import { incidentLine, incompleteLine, listTests } from './core'

export function buildAlertEmail(p: AlertPayload): { subject: string, text: string } {
  const { counts } = p
  const subject = p.incident
    ? `⚠️ ${p.projectName}: environment incident${p.incident.host ? `, ${p.incident.host}` : ''}`
    : p.incomplete
      ? `${counts.unexpected > 0 ? '🔴' : '⚠️'} ${p.projectName}: incomplete run, ${p.incomplete.landed} of ${p.incomplete.total} shards`
      : `${counts.unexpected > 0 ? '🔴' : '✅'} ${p.projectName}: ${counts.unexpected} failed, ${counts.flaky} flaky`
  const lines = [
    `${p.projectName} run ${p.incident ? 'hit an environment incident' : p.incomplete ? 'is incomplete' : 'finished'}.`,
    '',
    `${counts.expected} passed · ${counts.unexpected} failed · ${counts.flaky} flaky · ${counts.skipped} skipped`,
  ]
  if (p.incomplete)
    lines.push('', `${incompleteLine(p.incomplete)}.`)
  if (p.incident)
    lines.push('', incidentLine(p.incident))
  if (p.newlyFailing.length)
    lines.push('', `Newly failing (${p.newlyFailing.length}): ${listTests(p.newlyFailing, p.codeOwners)}`)
  if (p.newlyFlaky.length)
    lines.push('', `Newly flaky (${p.newlyFlaky.length}): ${listTests(p.newlyFlaky, p.codeOwners)}`)
  lines.push('', `View the run: ${p.runUrl}`)
  return { subject, text: lines.join('\n') }
}
