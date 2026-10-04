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

The block is built by the framework's `createBuildMetadataDefine(appDir)` (`GpsPlusSlamJs_AppFramework/scripts/build-metadata-define.mjs`, imported by relative path; node-only and not published), which the Tour Viewer's Vite config uses too - one define block for both apps (DEC-H3, 2026-09-28). It lived here until then.

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

Conditionally loaded — only active when `SENTRY_AUTH_TOKEN` is set. Without the
token, the plugin is excluded from the build pipeline entirely (evaluates to
`false` and is filtered out by Vite).

- **org**: `cs-util-com`
- **project**: `js-gps-recorder`
- **Auth token**: Read from `SENTRY_AUTH_TOKEN` environment variable

The plugin enables readable stack traces in Sentry error reports by uploading
source maps alongside each deployment. Local dev builds and public-repo
contributors build without the token — no source maps are uploaded.

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
