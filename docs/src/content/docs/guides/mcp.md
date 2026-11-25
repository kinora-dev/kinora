---
title: MCP for coding agents
description: Expose your kinora test data to Claude Code, Cursor, and other agents over MCP.
---

`@kinora/mcp` is an MCP server that exposes your kinora test data to coding agents (Claude
Code, Cursor, Claude Desktop, Windsurf, and others). Point an agent at your last CI failures and
let it pull the error, the trace, and the flaky-vs-regression history to go straight to the fix.

It runs locally over stdio and talks to either the hosted cloud or your self-hosted server.

## Setup

Add it to your agent's MCP config. It needs a kinora API token (create one in the dashboard under
project settings) and, for self-host, your server URL.

```json
{
  "mcpServers": {
    "kinora": {
      "command": "npx",
      "args": ["-y", "@kinora/mcp"],
      "env": {
        "KINORA_TOKEN": "<your api token>",
        "KINORA_URL": "https://api.kinora.dev"
      }
    }
  }
}
```

`KINORA_URL` defaults to the hosted cloud; set it to your own origin for self-host. Both can also
be passed as `--token` / `--url` flags.

## Tools

| Tool | What it returns |
| --- | --- |
| `list_projects` | Every project with its latest run summary. |
| `list_failures` | Failing/flaky tests of a run (defaults to latest): error, `file:line`, trace URL, and the [failure cause](/guides/failure-triage/) each one belongs to, with its state, assignee, known issue and note. |
| `list_open_failures` | The open failure causes of every project (or one), as the dashboard's [failure inbox](/guides/failure-triage/#the-failure-inbox): state (`failing`, `regressed`, `stopped`), what the team decided, the error and the affected tests. Filter by `state`; snoozed causes are left out unless `includeSnoozed`. |
| `get_run` | Full report for one run: counts, git/CI metadata, all test statuses, failures. |
| `test_history` | Per-test history: `health` (`stable`, `flaky` or `broken`, see [Flaky and broken tests](/guides/flaky-tests/)) with its reason, pass/fail/flaky rates, and `newlyBroken`/`newlyFlaky` flags to tell a fresh regression from a chronic/flaky test. |
| `get_trace` | The Playwright `trace.zip` URL for one test, to open in the viewer or download. |
| `component_health` | Per-component and per-story health from [component tests](/guides/component-testing/) and [Storybook stories](/guides/vitest/#storybook): latest status, `health` over the last 20 runs with its reason, accessibility violations from [Storybook's a11y addon](/guides/vitest/#accessibility), and the tests mounting each story. Filter by component, or by `health` (`flaky` or `broken`). |
