# @kinora/trace-viewer

Playwright trace replay engine, vendored from
[microsoft/playwright](https://github.com/microsoft/playwright) (Apache-2.0),
plus kinora's own UI on top.

## Layout

- `src/core/` - **vendored** engine, synced from Playwright `v1.63.0`.
  - `isomorphic/` - snapshot engine + trace model + helpers (`packages/isomorphic` upstream)
  - `trace/` - local compatibility type re-exports for kinora imports
  - `protocol/channels.ts` - minimal hand-written subset of `@protocol/channels`
    (only the types the engine references; not vendored verbatim)
  - `protocol/structs.d.ts` - vendored protocol structs referenced by upstream trace helpers
- `src/sw/` - **vendored** service worker that serves trace resources into the
  snapshot iframe (`trace-viewer/src/sw`)
- `src/ui/` - **ours**. The Vue UI (to build). This is the part we own.

The `@isomorphic` / `@protocol` path aliases in `tsconfig.json` mirror upstream
so the vendored files compile unedited. `@trace` is kept as a small local
compatibility alias for kinora's UI imports.

## Updating the vendored engine

The vendored engine should usually track the exact `@playwright/test` version in
this workspace. To re-sync after bumping Playwright:

```bash
pnpm vendor:playwright-trace
pnpm --filter @kinora/trace-viewer typecheck
pnpm --filter @kinora/trace-viewer test
pnpm --filter @kinora/trace-viewer build
pnpm --filter @kinora/trace-viewer test:e2e
```

`pnpm vendor:playwright-trace:check` verifies that the checked-in files match the
installed Playwright version. `.github/workflows/playwright-vendor.yml` runs that
check weekly and can be started manually.

## Local fixups (deltas from upstream)

Keep this list short; every entry is a re-sync cost.

1. `src/core/protocol/channels.ts` - hand-written minimal type stub instead of
   the full upstream `@protocol/channels` (which pulls the whole protocol).
2. `src/core/trace/*` - local type re-export shims for existing kinora imports.

The vendored files themselves are unedited. `@zip.js/zip.js` is pinned to the
exact version Playwright ships (`2.7.29`): newer 2.8.x dropped the
`lib/zip-no-worker-inflate.js` subpath the service worker imports and split the
`Entry` type, both of which would force edits to vendored files. Pinning keeps
them pristine.

## Browser harness

`index.html` + `src/main.ts` register the service worker
(`vite.sw.config.ts` bundles `src/sw-main.ts` to `public/sw.bundle.js`), load a
trace from `public/fixtures/`, and render one DOM snapshot in an iframe. Run
`pnpm dev`. This is a throwaway proof; the real Vue UI replaces `src/main.ts`.

## License

Vendored files keep their original Apache-2.0 headers (Copyright Microsoft
Corporation). New code under `src/ui/` is MIT, matching the rest of kinora.

