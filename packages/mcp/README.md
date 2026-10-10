# @kinora/mcp

MCP server that exposes your [kinora](https://kinora.dev) Playwright test data to coding agents (Claude Code, Cursor, Claude Desktop, Windsurf, …). Point an agent at your last CI failures and let it pull the error, the trace, and the flaky-vs-regression history to debug the fix.

## Setup

Add it to your agent's MCP config. It needs a kinora API key (create one in the kinora dashboard under Settings → Workspace) and, for self-host, your server URL.

```json
{
  "mcpServers": {
    "kinora": {
      "command": "npx",
      "args": ["-y", "@kinora/mcp"],
      "env": {
        "KINORA_TOKEN": "<your api key>",
        "KINORA_URL": "https://api.kinora.dev"
      }
    }
  }
}
```

`KINORA_URL` defaults to the hosted cloud; set it to your own origin for self-host. Both can also be passed as `--token` / `--url` flags.

## Documentation

The full tool list (`list_projects`, `list_failures`, `get_run`, `test_history`, `get_trace`, `component_health`) is in the docs:

**https://docs.kinora.dev/guides/mcp/**

## License

MIT.
