#!/usr/bin/env node
import process from 'node:process'
import { parseArgs } from 'node:util'
import { createReadClient, DEFAULT_KINORA_URL } from '@kinora/core'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import pkg from '../package.json' with { type: 'json' }
import { registerTools } from './tools'

const USAGE = `kinora-mcp - MCP server exposing kinora test failures and history to coding agents

Auth (env or flags):
  KINORA_TOKEN / --token <token>   kinora API key (required)
  KINORA_URL   / --url <url>       server base URL (default: hosted cloud; set for self-host)

Add to your agent's MCP config:
  { "mcpServers": { "kinora": {
      "command": "npx", "args": ["-y", "@kinora/mcp"],
      "env": { "KINORA_TOKEN": "<key>", "KINORA_URL": "https://api.kinora.dev" } } } }`

function resolveConfig(): { url: string, token: string } {
  const { values } = parseArgs({ options: { token: { type: 'string' }, url: { type: 'string' }, help: { type: 'boolean', short: 'h' } } })
  if (values.help) {
    process.stdout.write(`${USAGE}\n`)
    process.exit(0)
  }
  const token = values.token ?? process.env.KINORA_TOKEN
  if (!token) {
    process.stderr.write(`kinora-mcp: KINORA_TOKEN (or --token) is required\n\n${USAGE}\n`)
    process.exit(1)
  }
  return { url: values.url ?? process.env.KINORA_URL ?? DEFAULT_KINORA_URL, token }
}

async function main(): Promise<void> {
  const { url, token } = resolveConfig()
  const server = new McpServer({ name: 'kinora', version: pkg.version })
  registerTools(server, createReadClient({ baseUrl: url, token }))
  await server.connect(new StdioServerTransport())
  // stdout is the protocol channel; status goes to stderr.
  process.stderr.write(`kinora-mcp running (server: ${url})\n`)
}

main().catch((err) => {
  process.stderr.write(`kinora-mcp: fatal: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exit(1)
})
