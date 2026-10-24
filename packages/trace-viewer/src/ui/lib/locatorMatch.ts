// The part of a full selector that a frame's injected script can resolve, as upstream's
// InspectModeController does: frames are reached through `... >> internal:control=enter-frame >>`.
export function selectorForFrame(fullSelector: string, frameSelector: string): string | undefined {
  return fullSelector.startsWith(frameSelector) ? fullSelector.slice(frameSelector.length).trim() || undefined : undefined
}

export type LocatorMatches = number | 'invalid'

export interface MatchStatus {
  tone: 'pass' | 'fail' | 'flaky'
  label: string
  // What Playwright would do with this locator, the reason the count matters.
  hint?: string
}

// Kinora extra: upstream highlights matches but does not count them.
export function matchStatus(matches: LocatorMatches): MatchStatus {
  if (matches === 'invalid')
    return { tone: 'fail', label: 'Invalid locator' }
  if (matches === 0)
    return { tone: 'fail', label: 'No match', hint: 'An action on it would wait until it times out.' }
  if (matches === 1)
    return { tone: 'pass', label: '1 match' }
  return { tone: 'flaky', label: `${matches} matches`, hint: 'An action on it would fail in strict mode.' }
}
