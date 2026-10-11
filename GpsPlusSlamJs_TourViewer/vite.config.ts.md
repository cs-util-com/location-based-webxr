# vite.config.ts

## Purpose

The Tour Viewer's Vite config: the dev server (the e2e's too) and the build.

## Settings

- `server.port`: `5187` - this package's port (`../docs/dev-server-ports.md`).
- `server.host`: `true` - listen on all interfaces, so `127.0.0.1` (what the
  Playwright config polls) answers even where `localhost` resolves to IPv6.
- `define`: the build stamp, from the framework's
  `createBuildMetadataDefine(appDir)`
  (`../GpsPlusSlamJs_AppFramework/scripts/build-metadata-define.mjs`, the same
  block the RecorderApp uses, DEC-H3): `__BUILD_COMMIT__`, `__BUILD_TIME__`,
  `__APP_VERSION__`, `__LIB_VERSION__`, `__FW_VERSION__`, each bare and as
  `globalThis.__NAME__`.
- `build.rollupOptions.input`: `index.html` (the app) and
  `write-probe.html`, an on-device measurement page linked from nothing
  (`write-probe.html.md`); an entry so that it is built and reachable at
  `/tour/write-probe.html` on a branch preview, as the Recorder does for its
  measurement pages.

## Invariants & assumptions

- The stamp exists for the creator's troubleshooting recording: `main.ts`
  hands the framework's `getBuildInfo` to the recording's save, and its
  `session.json` carries `build` (authoring recording plan 2026-09-28-0953,
  §7a finding 2). In the dev server Vite's client assigns the
  `globalThis.__NAME__` properties; in a build the expressions are replaced
  in place, the framework's `dist` included.
- A version that cannot be read fails the config (the build and the dev
  server), so no build ships a made-up one; the commit falls back to `"dev"`
  without git.

## Tests

`playwright-tests/ar-mode.spec.js` (the recording e2e) reads a saved
recording's `session.json` and asserts its `build.commitHash` and
`build.frameworkVersion`; the block itself is pinned by the framework's
`scripts/build-metadata-define.test.mjs`.
