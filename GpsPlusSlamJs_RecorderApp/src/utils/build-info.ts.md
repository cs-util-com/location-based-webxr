# build-info.ts

## Purpose

Provides a single access point for build-time metadata injected by Vite's `define` block. All other modules import `getBuildInfo()` instead of referencing the raw `__BUILD_*__` globals directly.

## Public API

### `BuildInfo` (interface)

```typescript
interface BuildInfo {
  commitHash: string; // Short git hash (e.g. "a1b2c3d") or "dev"
  appVersion: string; // RecorderApp version from package.json
  libraryVersion: string; // gps-plus-slam-js version from package.json
  frameworkVersion: string; // AppFramework version from package.json
  buildTime: string; // ISO 8601 timestamp of when the build was produced
}
```

### `getBuildInfo(): BuildInfo`

Returns the current build metadata. Values are string literals replaced at build time by Vite — no runtime I/O occurs.

Throws if the expected injected globals are missing or are not strings. This keeps callers type-safe and fails fast if the Vite `define` wiring is broken.

## Invariants & Assumptions

- The helper reads explicit `globalThis.__BUILD_*__` / `globalThis.__*_VERSION__` properties so Vite can replace the exact expressions used at runtime. Computed lookups like `globalThis[name]` are intentionally avoided because Vite `define` does not synthesize runtime globals for that pattern.
- During unit tests the helper reads the real `globalThis` properties, so tests can stub them with `vi.stubGlobal()`.
- Missing or non-string metadata is treated as a configuration error and throws immediately.
- The function is pure and side-effect-free; safe to call at any point during app lifecycle.
- Type declarations for the globals live in `src/global.d.ts`.
- The `define` block lives in `config/vite.config.ts`.

## Examples

```typescript
import { getBuildInfo } from './utils/build-info';

const info = getBuildInfo();
console.log(`${info.appVersion} (${info.commitHash})`);
// → "0.1.0 (a1b2c3d)"
```

## Tests

- [`build-info.test.ts`](build-info.test.ts) — verifies returned shape with stubbed globals and the error path when metadata is absent.

## Related

- [2026-04-20-zip-debug-metadata-plan.md](../../../GpsPlusSlamJs_Docs/docs/2026-04-20-zip-debug-metadata-plan.md) — design plan for this feature.
