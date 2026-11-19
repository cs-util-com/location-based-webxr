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
  block the RecorderApp uses): `__BUILD_COMMIT__`, `__BUILD_TIME__`,
  `__APP_VERSION__`, `__LIB_VERSION__`, `__FW_VERSION__`, each bare and as
  `globalThis.__NAME__`.
- `build.rollupOptions.input`: `index.html` (the app) and
  `write-probe.html`, an on-device measurement page linked from nothing
  (`write-probe.html.md`); an entry so that it is built and reachable at
  `/tour/write-probe.html` on a branch preview, as the Recorder does for its
  measurement pages. And `edit.html`, the desktop editor (M6 E1, `edit.html.md`),
  reachable at `/tour/edit.html` and linked from the setup page's "You
  already have a tour?" box and step 5 on a device without AR (tour editor
  plan 2026-10-17-1816, W1). And `legal.html`, which forwards to the
  site-wide legal page at `/legal/` (`legal.html.md`), at `/tour/legal.html`.
  And `characters.html`, the character maker and the library of characters
  on this device (`characters.html.md`), at `/tour/characters.html`.
  And `file-access-check.html`, an on-device check of what a phone's
  browser lets the editor do with a file it saves, linked from nothing
  (`file-access-check.html.md`), at `/tour/file-access-check.html`.
  And the check pages `model-views-check.html`, `character-views-check.html`, `item-lab.html`,
  `lectern-check.html` (a long text on its reading stand,
  `lectern-check.html.md`), `then-now-check.html` (then and now's
  picture and its Swipe line, `then-now-check.html.md`) and `long-text-check.html` (a long text in
  its reading sheet, `long-text-check.html.md`), each linked from nothing.
- `plugins`: `globeAssetsRoute(<GpsPlusSlamJs_Globe/assets>)`
  (`src/dev-server/globe-assets-route.ts`): the dev server (and so the e2e)
  answers `/globe-assets/*` from the Globe package's committed assets,
  which the editor on the globe view (the default, `src/editor3d/editor3d-globe.ts`)
  loads. This build does NOT copy them: the site build
  (`scripts/build-site.mjs`) ships one copy at the site root,
  `dist-site/globe-assets/` (about 12.6 MB), shared with the look-dev
  labs, so the deployed `/tour/edit.html` resolves the same
  absolute paths. No visitor page's bundle names them
  (`src/app-bundle.test.ts`). Then the error service's Vite plugin
  (`@sentry/vite-plugin`), created by the framework's shared
  `scripts/sentry-vite-plugins.mjs`, only when `SENTRY_AUTH_TOKEN` is set:
  in a production build it gives every bundle a debug id, sets the release
  (the commit), uploads the source maps to the Recorder's project and then
  deletes every `.map` under the resolved output folder (the site build's
  `--outDir` included); the reports carry an `app: tour-viewer` tag (the
  framework's `utils/sentry-options.ts.md`). No build telemetry. Without
  the token (local, CI, a contributor) nothing runs and the build does not
  fail; a failed upload only warns. The token path was run by hand once,
  for the map demo's build only (its `vite.config.ts.md`); this build with
  the token is not verified.
- `worker.plugins`: the same plugin for the Web Worker bundles (the city
  build, the asset optimizer, the character cut, the cloud bake), which
  Vite bundles on their own: it gives them their debug ids. Their maps are
  emitted into the page build's output folder, uploaded and deleted by the
  page build's instance.
- `build.sourcemap: "hidden"`: maps are written for the upload, but no
  bundle carries a `sourceMappingURL` comment, so a visitor's browser never
  fetches them. With the token they are deleted after the upload; a build
  without the token keeps them beside the bundles.

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
