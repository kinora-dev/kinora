import { Buffer } from 'node:buffer'
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { app, safeStorage } from 'electron'

export interface Config {
  serverUrl: string
  // better-auth rejects auth requests without a trusted Origin; send the server's web origin.
  webOrigin: string
  token: string | null
  // Maps a cloud project id to its local repo root (for open-in-editor / re-run).
  projectPaths: Record<string, string>
  // Public Sentry DSN; only baked into packaged builds (dev = null = off).
  sentryDsn: string | null
}

// Packaged builds target the cloud; dev runs against the local stack.
const DEFAULTS: Config = app.isPackaged
  ? {
      serverUrl: 'https://api.kinora.dev',
      webOrigin: 'https://app.kinora.dev',
      token: null,
      projectPaths: {},
      sentryDsn: 'https://56e1c7b2e218cccf7b040482ac9a95e7@sonar.jorisgallot.dev/6',
    }
  : {
      serverUrl: 'http://localhost:3000',
      webOrigin: 'http://localhost:5173',
      token: null,
      projectPaths: {},
      sentryDsn: null,
    }

function configPath(): string {
  // Dev/prod isolation is handled by a separate userData dir in dev (see main.ts).
  return path.join(app.getPath('userData'), 'kinora-desktop.json')
}

export function loadConfig(): Config {
  try {
    const raw = JSON.parse(readFileSync(configPath(), 'utf8')) as Partial<{ token: string, projectPaths: Record<string, string> }>
    const token = raw.token && safeStorage.isEncryptionAvailable()
      ? safeStorage.decryptString(Buffer.from(raw.token, 'base64'))
      : null
    return { ...DEFAULTS, token, projectPaths: raw.projectPaths ?? {} }
  }
  catch {
    return { ...DEFAULTS, projectPaths: {} }
  }
}

export function saveConfig(config: Config): void {
  const token = config.token && safeStorage.isEncryptionAvailable()
    ? safeStorage.encryptString(config.token).toString('base64')
    : null
  writeFileSync(configPath(), JSON.stringify({ token, projectPaths: config.projectPaths }))
}
