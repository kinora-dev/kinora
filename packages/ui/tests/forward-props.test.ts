import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('../src/components/ui', import.meta.url))

function vueFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? vueFiles(path) : entry.name.endsWith('.vue') ? [path] : []
  })
}

// Vue casts an absent boolean prop to `false`. A wrapper that binds its own props straight onto
// a Reka component therefore sends `false` for every boolean the caller left out, silently
// overriding Reka's default when that default is `true` (TabsList lost its keyboard loop this way)
// or `undefined`. `useForwardProps` only forwards what was actually passed, so Reka's defaults hold.
// Nothing else flags this: no type error, no warning, and the component still renders.
const TYPED_ON_REKA = /import type \{[^}]*Props\b[^}]*\} from 'reka-ui'/

// The raw props object, or any copy of it made with reactiveOmit, whatever it is named.
function rawPropsNames(source: string): string[] {
  return ['props', '$props', ...[...source.matchAll(/const (\w+) = reactiveOmit\(/g)].map(match => match[1])]
}

function bindsRawProps(source: string): boolean {
  return rawPropsNames(source).some(name => source.includes(`v-bind="${name}"`) || source.includes(`...${name},`) || source.includes(`...${name} }`))
}

describe('reka wrappers', () => {
  const wrappers = vueFiles(ROOT).filter(file => TYPED_ON_REKA.test(readFileSync(file, 'utf8')))

  it('finds the wrappers to check', () => {
    expect(wrappers.length).toBeGreaterThan(50)
  })

  it('forward their props through useForwardProps, never directly', () => {
    const offenders = wrappers
      .filter(file => bindsRawProps(readFileSync(file, 'utf8')))
      .map(file => relative(ROOT, file))
    expect(offenders, 'bind the result of useForwardProps(...) instead of the raw props').toEqual([])
  })
})
