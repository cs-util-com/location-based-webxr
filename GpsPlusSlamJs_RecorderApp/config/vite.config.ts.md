# vite.config.ts

## Purpose

Vite configuration for development server and production build.

## Settings

| Setting       | Value         | Description              |
| ------------- | ------------- | ------------------------ |
| `root`        | `..` (parent) | Project root             |
| `server.host` | `true`        | Listen on all interfaces |
| `server.port` | `5173`        | Dev server port          |

## Build Metadata

The config injects five build-time string constants via `define`:

- `__BUILD_COMMIT__`
- `__BUILD_TIME__`
- `__APP_VERSION__`
- `__LIB_VERSION__`
- `__FW_VERSION__`

The block is built by the framework's `createBuildMetadataDefine(appDir)` (`GpsPlusSlamJs_AppFramework/scripts/build-metadata-define.mjs`, imported by relative path; node-only and not published), which the Tour Viewer's Vite config uses too - one define block for both apps (2026-09-28). It lived here until then.

Package versions are read from the relevant `package.json` files and validated to ensure they contain a string `version` field before being exposed to the app.

The metadata is defined twice for each field: once as a bare constant (`__BUILD_COMMIT__`) and once as an explicit `globalThis.__BUILD_COMMIT__` property access. The framework's reader (`gps-plus-slam-app-framework/utils/build-info`) reads the `globalThis.__...` properties; the bare form keeps direct-constant use working.

All metadata values are computed once per config load, then reused for every define entry so the duplicated keys stay identical.

## Why Host: true?

Enables access from:

- Android device on same network
- Chrome DevTools port forwarding
- ngrok tunneling for HTTPS

## Path Alias

- `@app/*` → `src/*`
- `gps-plus-slam-app-framework` → `../../GpsPlusSlamJs_AppFramework/src` (source alias — imports AppFramework source directly instead of a built package, enabling HMR across both packages)

### resolve.dedupe

`resolve.dedupe: ['three']` ensures Vite resolves the `three` package from RecorderApp's `node_modules`, not from AppFramework's directory. This is necessary because AppFramework declares `three` as a `peerDependency` (no local install), and the source alias causes Vite to try resolving `three` from the AppFramework path.

See [2026-03-30-separate-public-repo-plan.md §3.5](../../GpsPlusSlamJs_Docs/docs/2026-03-30-separate-public-repo-plan.md) for the full source-alias vs built-package trade-off analysis.

## Plugins

### Sentry Vite Plugin

Created by the framework's shared `scripts/sentry-vite-plugins.mjs` (imported
by relative path), the same helper the Tour Viewer and the map demo use, and
only when `SENTRY_AUTH_TOKEN` is set:

- With the token, in a production build: every bundle gets a debug id, the
  commit becomes the release, the source maps are uploaded to the
  `js-gps-recorder` project, and then every `.map` under the resolved output
  folder (the site build's `--outDir` included) is deleted, so no map is
  deployed. No build telemetry; a failed upload only warns, and the maps are
  deleted anyway. The site build's `scripts/source-maps-deploy.mjs` fails a
  build with the token that left a `.map` under `recorder/`.
- Without the token (local dev, CI, a contributor): no plugin runs, nothing is
  uploaded or deleted, and the build does not fail.
- `worker.plugins`: the same plugin for the Web Worker bundles (image quality,
  occluder mesh), for their debug ids; their maps land in the page build's
  output folder and are uploaded and deleted by the page build's instance.
- `build.sourcemap: 'hidden'`: the maps are written for the upload, but no
  bundle carries a `sourceMappingURL` comment, so a visitor's browser never
  fetches them. Without the token they stay in the output folder, unreferenced,
  as in the other two apps.

The token path is not run by any gate; see the helper's sidecar for what was
checked by hand.

## Usage

```bash
npm run dev       # Start dev server
npm run build     # Production build
npm run preview   # Preview production build
```

## Environment Variables

| Variable            | Required | Description                       |
| ------------------- | -------- | --------------------------------- |
| `SENTRY_AUTH_TOKEN` | For prod | Sentry auth token for source maps |
