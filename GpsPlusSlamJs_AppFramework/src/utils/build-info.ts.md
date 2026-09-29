# build-info.ts

## Purpose

The single reader of an app's build stamp: the five constants a Vite
`define` block injects at build time (commit, app / library / framework
versions, build time). Moved here from the RecorderApp on 2026-09-28, when
the Tour Viewer's troubleshooting recording started writing a `session.json`
of its own
([authoring recording plan](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-09-28-0953-tour-viewer-authoring-recording-anchoring-and-editing-plan.md)
§7a, M1a review finding 2): the names are a contract between the build and
this reader, so they have one reader (DEC-H3). The build half is
[`scripts/build-metadata-define.mjs`](../../scripts/build-metadata-define.mjs.md).

Deep import only: `gps-plus-slam-app-framework/utils/build-info` (not on the
`/utils` barrel or the root export surface).

## Public API

### `BuildInfo` (interface)

```typescript
interface BuildInfo {
  commitHash: string; // Short git hash (e.g. "a1b2c3d") or "dev"
  appVersion: string; // The app's own package.json version
  libraryVersion: string; // gps-plus-slam-js, as the app resolves it
  frameworkVersion: string; // gps-plus-slam-app-framework, as the app resolves it
  buildTime: string; // ISO 8601 timestamp of when the build was produced
}
```

The same shape as `SessionMetadata["build"]` (`storage/opfs-storage.ts`), so
it passes straight to `buildSessionMetadataRecord({ getBuildInfo })`.

### `getBuildInfo(): BuildInfo`

Returns the current build metadata. Throws
`Missing or invalid build metadata: <NAME>` when a constant is missing or not
a string (a unit test, or an app built without the `define` block); callers
decide what that costs (the session.json builder drops its `build` field, the
Recorder's settings modal shows "Build unavailable").

## Invariants & Assumptions

- Each constant is read as an explicit `globalThis.__NAME__` expression, with
  the type cast written in place so the EMITTED code still reads
  `globalThis.__NAME__`. That text is what Vite's `define` replaces in a build
  (the app's code and its dependencies, this package's `dist` included), and
  the property Vite's dev client assigns from the same block. A computed
  `globalThis[name]`, or an alias of `globalThis`, would be replaced in
  neither.
- No `declare global`: a library adds no globals to its consumers' type scope.
  An app that reads a constant directly declares it itself (the Recorder's
  `src/global.d.ts`).
- Pure and side-effect-free; reads the globals at call time, so tests stub
  them with `vi.stubGlobal()`.

## Examples

```typescript
import { getBuildInfo } from 'gps-plus-slam-app-framework/utils/build-info';

const info = getBuildInfo();
console.log(`${info.appVersion} (${info.commitHash})`);
// -> "0.1.0 (a1b2c3d)"
```

## Tests

- [`build-info.test.ts`](build-info.test.ts) - the returned shape with
  stubbed globals, and the throw for a missing or non-string constant.
- [`scripts/build-metadata-define.test.mjs`](../../scripts/build-metadata-define.test.mjs) -
  the round trip: the define block, applied as the dev client applies it, is
  read back whole.
- Consumers: the RecorderApp (`stop-recording.ts`, `ui/settings-modal.ts`) and
  the Tour Viewer (`main.ts`, into its recording's `session.json`; its
  `ar-mode.spec.js` e2e asserts the stamp in a saved zip).
