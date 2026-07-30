# `licensing/index.ts`

## Purpose

Public barrel for the AppFramework's licensing surface. Re-exports the
bundled `COMMUNITY_LICENSE_KEY` so consumers of
`gps-plus-slam-app-framework/licensing` keep a stable import path even
though the constant itself now lives in the core library.

## Public API

- `COMMUNITY_LICENSE_KEY: string` — re-exported from
  `gps-plus-slam-js/community-license-key`. Same value, same opt-in
  semantics: it only takes effect if the consumer passes it (or relies
  on `createSlamAppStore`'s default) when activating the library.

## Invariants & assumptions

- Source of truth is the core lib (`gps-plus-slam-js`). Re-signing
  happens in that repo's CI; the AppFramework just re-exports.
- See
  [../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md](../../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md)
  §3.6 (Option F) for the rationale of the cross-repo move.
- The AppFramework's `prepublishOnly` runs
  `verify:community-key-lifetime` against the resolved core-lib copy as
  defense-in-depth.

## Examples

```ts
import { COMMUNITY_LICENSE_KEY } from 'gps-plus-slam-app-framework/licensing';
import { createGpsSlamStore } from 'gps-plus-slam-js';

const store = createGpsSlamStore({ licenseKey: COMMUNITY_LICENSE_KEY });
```

## Tests

- `src/state/create-slam-app-store.license-key.test.ts` — exercises the default-license
  path through `createSlamAppStore`.
- `src/test-setup.ts` — calls `validateLicenseKey(COMMUNITY_LICENSE_KEY)`
  at vitest setup, so any test importing from the framework implicitly
  proves this re-export resolves and the token is currently valid.
