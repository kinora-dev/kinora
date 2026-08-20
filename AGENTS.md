# kinora

Guidance for agents in this repo. Shared stack conventions are imported above; everything below is kinora-specific and overrides the profile where they differ.

## What this is

kinora is a dashboard for Playwright test reports across projects and over time, with an embedded trace viewer. CI runs push results to a self-hosted kinora server; the dashboard tracks pass rates, trends, and flaky tests, and opens the full Playwright trace inline for failures.

pnpm workspace monorepo. Node 26, ESM-only (except `desktop`, see below), TypeScript strict. Fair source: `server`, `web`, and `desktop` are FSL-1.1-MIT (source-available, converts to MIT after 2 years); the embeddable libs (`reporter`, `cli`, `core`, `ui`, `mcp`) and `trace-viewer` are MIT.

`packages/desktop` is an Electron app: a local Playwright trace viewer (no account) plus an account dashboard that signs in to a kinora server. See the Desktop app section below.

## Commands

Run from the repo root unless noted.

```bash
pnpm install
pnpm build         # pnpm -r build, every package (tsdown for libs/server, vite for web/viewer)
pnpm typecheck     # tsc / vue-tsc across the workspace
pnpm lint          # eslint . (lint:fix to autofix)
pnpm test          # pnpm -r test (vitest). NOTE: server has no `test` script, so this skips it
pnpm test:integration  # pnpm -r test:integration; only @kinora/server has it (needs Postgres on :5436)
pnpm test:e2e      # pnpm -r test:e2e (trace viewer + web); --filter @kinora/web test:e2e to scope
                   # web e2e self-boots server+web via Playwright `webServer` (packages/web/playwright.config.ts)
                   # on dedicated ports against the `kinora_e2e` DB; only needs Postgres up on :5436

pnpm dev:server    # @kinora/server on :3000 (tsx watch)
pnpm dev:web       # dashboard on :5173
pnpm dev:viewer    # trace viewer on :5174
```

Desktop (from `packages/desktop`; build the viewer once first - the app serves its `dist/`):

```bash
pnpm --filter @kinora/trace-viewer build  # one-time, from repo root
pnpm dev                          # build main (cjs) + home UI, launch Electron
pnpm start path/to/trace.zip      # open a specific local trace
pnpm probe                        # headless self-check, exits 0/1 (VIEWER; HOME via probe:home)
pnpm dist:mac                     # local package (dmg + zip). The signed+notarized release is the Desktop Release CI workflow
```

CI (`.github/workflows/ci.yml`) is three jobs: `check` (lint -> typecheck -> build -> test), `integration_tests` (Postgres service + `@kinora/server test:integration`), and `e2e_tests` (Postgres service; `pnpm test:e2e` self-boots the stack on dedicated ports and resets `kinora_e2e` via `db:reset:e2e`, runs both the viewer and web suites). Build is in CI because cross-package types resolve through each lib's build output for published packages.

Single test / package-scoped:

```bash
pnpm --filter @kinora/core test                      # one package's vitest suite
pnpm --filter @kinora/core exec vitest run -t "name" # one test by name
pnpm --filter @kinora/server test:integration        # server suite (Postgres must be up)
pnpm --filter @kinora/server typecheck               # one package's typecheck
```

Server database (from `packages/server`, needs `.env` copied from `.env.example` and `docker compose up -d` against `packages/server/docker-compose.yml` for Postgres on :5436):

```bash
pnpm migrate           # apply pending migrations (alias: `pnpm migrate latest`); knex CLI args pass through
pnpm db:create         # create the database
pnpm db:seed           # seed demo account + data, prints login (demo@kinora.dev / password123) + an API token
pnpm db:seed:market    # larger "marketing" seed dataset
pnpm db:reset:e2e      # drop + recreate `kinora_e2e` (used by web e2e)
pnpm purge-expired-runs # retention sweep: delete runs past their retention window
```

Migrations are **knex**, not drizzle: hand-written `.ts` files in `packages/server/migrations/` (timestamp-prefixed), run by `scripts/migrate.ts`. Drizzle is the query/ORM layer only - there is no `drizzle.config.ts` and no schema-push/generate flow. To change the schema: edit `src/db/schemas/`, then add a matching knex migration. The migrate config reads connection details from `src/lib/env.ts`; in dev it loads `.ts` migrations, in prod the build emits them as `.mjs` in `dist/`.

## Architecture

### Ingest data flow

A test result travels: **Playwright run -> reporter or CLI -> `@kinora/core` normalize -> POST `/api/v1/runs` -> Postgres -> tRPC `dashboard` router -> `@kinora/web`**, with trace.zip artifacts on a parallel path.

- `@kinora/core` is the shared contract layer. zod schemas in `src/contracts/` (`kinora.ts` = stored/dashboard shapes, `ingest.ts` = the wire payload, `playwright.ts` = raw report shape) plus pure helpers in `src/lib/` (`normalize`, `aggregate`, `history`, `compare`, `status`, `test-key`). Both ingest paths and the server depend on it, so a test keeps a stable identity regardless of how it was uploaded.
- **`makeTestKey(file, titlePath, projectName)`** (`core/src/lib/test-key.ts`) is the cross-run identity. The reporter rebuilds it from the Playwright suite tree (`identity()` in `reporter/src/index.ts`); the CLI derives it via `normalize` from `results.json`. Both must produce the same key or history breaks.
- **`SCHEMA_VERSION`** (`core/src/contracts/kinora.ts`) is stamped on `Manifest` and `RunReport`. Bump it when the stored/dashboard shape changes.

### Two distinct auth paths on the server

`packages/server` is a Hono app (`src/app.ts`) exposing two surfaces, both via better-auth:

1. **Public ingest API** (`src/public-api/`, mounted at `/api/v1`): plain REST, authed by API key (`Bearer` token verified with `auth.api.verifyApiKey`). This is what the reporter/CLI hit. Kept REST so any CI/curl/language can post. The token's `referenceId` is the owning user id. `read.ts` adds API-key GET read routes (projects, runs, failures, per-test history) on the same surface, backed by the shared `src/reports/queries.ts` service that also powers the tRPC `dashboard` router; `@kinora/mcp` consumes them via `core`'s `createReadClient`.
2. **Dashboard API** (`src/router/`, tRPC at `/trpc`): session-cookie authed. `authProcedure` (in `src/trpc/index.ts`) gates on `ctx.user`; `dashboardRouter` scopes every query to the session user and rejects projects they don't own (`ownedProject`).

`auth.handler` serves better-auth's own routes at `/api/auth/*`; `/api/slack` is the Slack "Add to Slack" OAuth callback (`src/slack/oauth.ts`). Order in `app.ts` matters: `/artifacts/*` static serving with permissive CORS is registered _before_ `secureHeaders`/global CORS so its headers don't block the viewer's cross-origin service-worker fetch. `/api/v1/*` has a `bodyLimit` (large trace.zip uploads).

The desktop app authenticates via the **OAuth 2.0 device authorization grant** (better-auth `deviceAuthorization` plugin in `src/lib/auth.ts`; client id `kinora-desktop`). The user approves at `WEB_ORIGIN/device` (a `meta.public` web route), and the app polls `/api/auth/device/token` for the bearer token. So treat device-grant as a third auth path on top of the two REST/tRPC surfaces.

### Cloud vs self-host, alerts, billing

One codebase, two deployment modes gated by `KINORA_CLOUD` (env). Self-host (`false`) unlocks every feature; cloud (`true`) enables **Polar** billing.

- **Billing** (`src/billing/`): `polar.ts` (Polar SDK + better-auth plugin), `entitlements.ts` / `usage.ts` (plan limits: monthly test results, projects, and artifact bytes - the storage cap rejects an over-quota upload with a 402 and deletes the blob it just streamed), `retention.ts` (per-plan run-retention windows, swept by `purge-expired-runs`).
- **Retention** (`src/billing/retention.ts`): cloud derives windows from the plan tier and is swept by an external cron calling `purge-expired-runs`. Self-host instead reads `retentionPolicy` from env (`KINORA_ARTIFACT_RETENTION_DAYS` drops blobs but keeps runs; `KINORA_RETENTION_DAYS` / `KINORA_KEEP_LAST_RUNS` delete runs), and `src/index.ts` runs a daily in-process sweep gated on that policy being non-null, so cloud never double-sweeps.
- **Alerts** (`src/alerts/`): per-project notifications on new failures / regressions. Channels are `slack.ts`, `email.ts` (nodemailer/SMTP), `webhook.ts`, dispatched by `notify.ts` with an every-run / on-failure / on-regression policy (`core.ts`).
- **Feedback** (`src/feedback/`, `feedback` tRPC router): in-app "Send feedback" posts bug/feature reports to the private cloud task tracker. Cloud-only: `resolveFeedbackTracker` in `env.ts` returns null unless `KINORA_CLOUD=true` and all `FEEDBACK_TRACKER_*` vars are set; `config.get.feedbackEnabled` gates the web UI.
- Email (password reset, verification, invitations, alerts) needs `SMTP_*`; social login needs `GOOGLE_*` / `GITHUB_*`. All optional - empty disables the flow.

### Persistence

Drizzle (query layer) + Postgres. Schema in `src/db/schemas/` split into `auth-schemas.ts` (better-auth tables) and `kinora-schemas.ts` (`project`, `run`, `test`, `artifact`). jsonb columns (`counts`, `git`, `ci`, `titlePath`, `errors`, `attachments`, ...) are typed from `@kinora/core` types via `.$type<>()`, so the DB row shape and the contract stay in sync. Schema changes are migrated via knex (see Commands).

Binary artifacts (trace.zip) go through the `Storage` interface in `src/lib/storage.ts`: local FS (`STORAGE_DIR`) by default, or any S3-compatible store (AWS / R2 / MinIO / Hetzner) when all five `S3_*` env vars are set. The dashboard `run` query resolves `storageKey` -> absolute URL at read time and merges it into each test's attachments.

### Frontend

`packages/web` is Vue 3 + vue-router + tRPC client + Tailwind v4. The tRPC client (`src/lib/trpc.ts`) imports `AppRouter` **as a type** from `@kinora/server` for end-to-end type safety; requests send credentials for the session cookie. Routing (`src/router/index.ts`) gates on `session.ensure()` with a `meta.public` flag for login/signup. Build-time config comes from `VITE_KINORA_*` env, validated by `@julr/vite-plugin-validate-env` in `vite.config.ts` (`VITE_KINORA_SERVER_URL` is required). `@` aliases `src/`.

`@kinora/ui` is the shared shadcn-vue design system (Reka UI + Tailwind), consumed by both `web` and `trace-viewer`. Its `exports` map exposes component groups via `./*`.

### Trace viewer

`packages/trace-viewer` is the Playwright trace replay engine **vendored from microsoft/playwright (Apache-2.0)** under `src/core/` and `src/sw/`, wrapped by kinora's own Vue UI in `src/ui/`

- **Do not edit or lint the vendored code.** `src/core/**`, `src/sw/**`, `src/sw-main.ts`, and `public/sw.bundle.js` are in eslint's `ignores` (`eslint.config.js`).
- The service worker is built as a separate step: `build:sw` (`vite.sw.config.ts`) bundles `src/sw-main.ts` into a single IIFE classic script at `public/sw.bundle.js`. `dev` and `build` run `build:sw` first.
- In prod the viewer is served under `/trace/` (`vite.config.ts` sets `base: '/trace/'` on build); the dashboard links to it via `traceViewerHref` (`web/src/lib/trace.ts`), passing the artifact URL as `?trace=`.

### Desktop app

`packages/desktop` is the Electron shell. **Its main process runs as CommonJS**: Electron's main + sandboxed preload run most reliably as CJS (ESM would force `sandbox: false`), so tsdown emits `dist/main.cjs` - the `.cjs` extension forces CommonJS regardless of the package's `"type": "module"`. A separate Vite build compiles the home UI (`home/`) to `home/dist`.

- **Loopback server** (`src/server.ts`): the main process starts a local HTTP server that serves the home UI under `/home/`, the vendored `@kinora/trace-viewer` `dist/` (unmodified) under `/trace/`, and local zips via `/file?path=` with **Range/206** support (mandatory: the trace SW reads zips via Range GETs). Renderers are loaded from this loopback server, never `file://`, so the SW + Range behave exactly as on the web. Resources come from workspace deps in dev, `resourcesPath/<name>` when packaged.
- **Entry** (`src/main.ts`): owns the home + viewer `BrowserWindow`s, IPC handlers, and probes. A trace can arrive three ways - File > Open Trace, drag-drop, or a `.zip` path arg / macOS `open-file`.
- **Account / dashboard**: `account.ts` (email+password sign-in), `device.ts` (device-grant flow, see auth section), `config.ts` (server + web-origin URLs come from the build - `api`/`app.kinora.dev` when packaged, localhost in dev; only the bearer token (via Electron `safeStorage`) and per-project repo paths persist - URLs are never read back from disk), `trpc.ts` (typed dashboard client reusing the server's `AppRouter` type). `bridge.ts` defines the IPC contract; `home-preload.ts` exposes it as `window.kinora`.
- **Local re-run** (`runner.ts`): re-runs a single test locally with the repo's own Playwright (falls back to `npx --no-install`, never auto-installs) and watches for the produced `trace.zip`. `resolve.ts` maps a Playwright-reported `file` (relative to its `rootDir`, not repo root) to the real file and the nearest `playwright.config.*` dir (the re-run cwd). `editor.ts` opens a file at `line:col` in `code`/forks (override `KINORA_EDITOR_CMD`); GUI launch strips PATH, so it augments PATH with the usual install dirs.
- **Probes**: `KINORA_DESKTOP_PROBE` / `KINORA_HOME_PROBE` / `KINORA_DEVICE_PROBE` render headless, assert, and exit 0/1 (`pnpm probe`, `pnpm probe:home`). `build`/`typecheck`/`test` run in root CI.
- **Release + auto-update**: the **Desktop Release** workflow (`.github/workflows/desktop-release.yml`, manual `workflow_dispatch`) builds on a matrix of runners - macOS (`--mac`, dmg+zip, arch `arm64`+`x64`, signed via `CSC_LINK`/`CSC_KEY_PASSWORD` + notarized via `APPLE_ID`/`APPLE_APP_SPECIFIC_PASSWORD`/`APPLE_TEAM_ID`), Windows (`--win`, nsis), and Linux (`--linux`, AppImage). Win/Linux ship **unsigned** for now (no code-signing cert; signing env is gated to the mac job). A one-shot `draft` job pre-creates the **draft** GitHub Release for the version in `package.json` so the concurrent matrix jobs upload into it instead of racing to create it. Auto-update is wired via `electron-updater` against that GitHub feed (`publish: github` in `electron-builder.yml`): background download + an in-app "Restart to update" pill (`main.ts` -> bridge -> `AppHeader.vue`), install-on-quit fallback. The branded install DMG (`build/dmg-background.png` + `build/icon.icns` volume icon, laid out in `electron-builder.yml`) needs **electron-builder ≥26** - its `dmgbuild` engine is the one whose `.DS_Store` macOS 26 (Tahoe) actually honors; the v25 writer renders a blank background there.

### Deployment

Two per-package Dockerfiles, both built from the **repo root** (workspace context):

- `packages/web/Dockerfile`: builds `web` + `trace-viewer` static output, serves both from nginx (dashboard SPA at `/`, viewer at `/trace`). `VITE_KINORA_SERVER_URL` is baked at build time via `--build-arg`, and is **optional**: unset means same origin (`web/src/lib/env.ts` falls back to `window.location.origin`), which is what self-host runs. `VITE_KINORA_VIEWER_URL` defaults to `/trace/` (same origin). `NGINX_CONF` picks the config baked in (cloud static-only by default, `selfhost/nginx.conf` for the single-origin image).
- `packages/server/Dockerfile`: the Node/`tsx` server image. Its `migrate.mjs` is also the entrypoint for the one-shot migration step.

`selfhost/` is the shipped single-origin self-host bundle: `docker-compose.yml` (Postgres + one-shot `migrate` + server + web) and `nginx.conf` (the web container reverse-proxies `/api`, `/trpc`, `/artifacts` to the server, so there's no CORS and the cookie stays host-only). Configured by `selfhost/.env`; runs `KINORA_CLOUD=false`. It **pulls prebuilt images** (`ghcr.io/kinora-dev/kinora-{server,web}:${KINORA_VERSION:-latest}`), so users need no clone and no build; `docker-compose.build.yml` is the override that restores `build:` from a checkout. The **Docker Release** workflow (`.github/workflows/docker-release.yml`, manual `workflow_dispatch` with a version input) publishes them: one job per image per arch on native runners (`ubuntu-latest` + `ubuntu-24.04-arm`, pushing by digest), then a `manifest` job folds the digests into the version/`latest` tags with `docker buildx imagetools create`. The published web image bakes `selfhost/nginx.conf`.

### Marketing site

`website/` is a standalone **Astro** site (its own pnpm workspace + lockfile + `Dockerfile`, **not** part of the root `packages/*` workspace). Build/dev separately from `website/` (`pnpm dev` / `pnpm build`).

## Conventions

- ESLint is `@antfu/eslint-config` (vue + typescript). No Prettier; lint owns formatting.
- ESM only (`"type": "module"`), `.ts` extension imports allowed (`allowImportingTsExtensions`). Exception: `packages/desktop` emits its main/preload as CommonJS `.cjs` (Electron requirement, see Desktop app) even though the package itself is `"type": "module"`.
- Libs build with `tsdown`; their published `exports` point at `dist/`, but in-repo `exports` point at `src/` so the workspace consumes TypeScript source directly.
