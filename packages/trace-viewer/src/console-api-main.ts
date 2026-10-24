import type { Language } from '@isomorphic/locatorGenerators'
import { InjectedScript } from '@injected/injectedScript'

// Runs inside a popped-out snapshot (built to public/console-api.bundle.js), so `playwright.$`
// and friends live in the snapshot's own realm: their `instanceof Element` checks hold there.
const options = (document.currentScript as HTMLScriptElement | null)?.dataset ?? {}
new InjectedScript(window, {
  isUnderTest: options.isUnderTest === 'true',
  frameSeq: 0,
  sdkLanguage: (options.sdkLanguage ?? 'javascript') as Language,
  testIdAttributeName: options.testIdAttributeName ?? 'data-testid',
  stableRafCount: 1,
  browserName: 'chromium',
  customEngines: [],
}).consoleApi.install()
