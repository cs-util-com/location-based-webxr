# `test-setup.ts`

## Purpose

Licence activation for `gps-plus-slam-app-framework` tests. Activates
the `gps-plus-slam-js` library when imported, so any
public API (reducers, action creators, selectors, math helpers like
`calcGpsCoords` / `calcRelativeCoordsInMeters`) is
callable from framework tests without each test manually constructing a
store via `createSlamAppStore()` / `createGpsSlamStore({ licenseKey })`.

## Public API

None — it runs for its side effect only. A unit test that reaches a licensed
export imports it as its FIRST import (`import '../test-setup';`), so the
library is active before any module under test loads; the bench config
(`config/vitest.bench.config.ts`) still loads it as a setup file. It is not
a global unit-test setup any more: the activation costs about 0.1 s per file
(signature verification), and 22 of the 414 test files need it. A file that
forgets the import fails loudly with the library's own "license not
activated" error, so the cause is named in the red.

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

`tests/repo-config/framework-licence-setup.test.js` pins the two silent ways
of getting this wrong: it stays the first import of the files that use it, and
it stays a setup file of the bench config.

## Examples

`import '../test-setup';` at the top of the test file. Verification is
implicit: the test files that import it (e.g. `src/utils/fused-path.test.ts`,
`src/state/store-subscribers.test.ts`, `src/visualization/gps-anchor.test.ts`)
fail with `license not activated` without it, and pass with it.

## Tests

This file has no dedicated test. Its correctness is proven by the full
framework suite passing.
