# @kinora/cli

CLI that uploads a Playwright `json` report to a [kinora](https://github.com/kinora-dev/kinora) server. Use it when you can't run the [`@kinora/reporter`](https://github.com/kinora-dev/kinora/tree/main/packages/reporter) inline (e.g. results are produced in one CI job and uploaded from another), or to bulk-import a backlog of historical reports.

## Upload a report

Produce `results.json` with Playwright's built-in json reporter:

```ts
// playwright.config.ts
reporter: [['json', { outputFile: 'results.json' }]]
```

Then upload it:

```bash
npx @kinora/cli upload results.json --project web-app --token <project-token>
```

Create a project API token in the kinora dashboard (Settings → Workspace). Auth can also come from the environment (`KINORA_TOKEN`, `KINORA_URL`). Self-hosting? Point at your server with `--url` / `KINORA_URL`.

Only traces are uploaded by default. Running without tracing? Upload the videos and screenshots
on their own with `--upload-attachments trace,video,screenshot`.

Bulk-import a backlog of historical reports with `kinora import <dir>`.

## Documentation

All flags, bulk import, PR/MR comments, and CI examples are in the docs:

**https://docs.kinora.dev/guides/cli/**

## License

MIT
