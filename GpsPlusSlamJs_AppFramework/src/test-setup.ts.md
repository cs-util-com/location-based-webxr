# `test-setup.ts`

## Purpose

Process-wide vitest setup file for `gps-plus-slam-app-framework`. Activates
the `gps-plus-slam-js` library once at the start of the test process so any
public API (reducers, action creators, selectors, math helpers like
`calcGpsCoords` / `calcRelativeCoordsInMeters`) is
callable from framework tests without each test manually constructing a
store via `createSlamAppStore()` / `createGpsSlamStore({ licenseKey })`.

## Public API

None — this file is loaded by vitest via
`config/vitest.config.ts#test.setupFiles` and runs for its side effect only.

## Invariants & assumptions

- Uses the public `validateLicenseKey()` API exported from
  `gps-plus-slam-js`, with the bundled `COMMUNITY_LICENSE_KEY` from
  `gps-plus-slam-js/community-license-key` — exercising the real
  activation code path (signature verification + expiry check). The
  community key now lives **inside the core lib** and is re-signed by
  `gps-plus-slam-js`'s own CI; see
  [../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-05-01-community-key-resign-cross-repo-issue.md)
  §3.6 (Option F) for the rationale.
- Same pattern as RecorderApp's integration tests
  (`GpsPlusSlamJs_RecorderApp/src/state/recording-replay.integration.test.ts`).
- `gps-plus-slam-js` is resolved from `node_modules` — either the published
  npm package, or a local symlink injected by the repo-root `.pnpmfile.cjs`
  when the maintainer sets `LOCAL_CORE`. Activation is by definition
  module-instance-scoped: `validateLicenseKey()` activates whichever
  instance is resolved at runtime, so this works equally well against
  `dist/` and against the local-source symlink.
- `COMMUNITY_LICENSE_KEY` carries a rolling 12-month expiration and is
  renewed each release. If framework tests start failing with
  `license expired`, regenerate via the key-rotation tooling shipped with
  `gps-plus-slam-js`.

## Examples

Loaded automatically — no usage by hand. Verification is implicit: every
gated framework test that previously failed with `license not activated`
(e.g. `src/utils/fused-path.test.ts`,
`src/visualization/reference-points.test.ts`,
`src/state/store-subscribers.test.ts`) now passes.

## Tests

This file has no dedicated test. Its correctness is proven by the full
framework suite passing.
