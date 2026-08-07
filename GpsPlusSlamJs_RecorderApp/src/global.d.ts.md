# global.d.ts

## Purpose

Declares recorder-app-specific global types for Playwright test hooks and build metadata injected by Vite.

## Public API

### Window extensions

- `window.testHooks` exposes selected UI helpers for Playwright E2E tests in development mode.
- `window.refPointPickerApi` exposes the real reference-point picker flow for browser-driven tests.

### Global build metadata

- `__BUILD_COMMIT__?: string`
- `__BUILD_TIME__?: string`
- `__APP_VERSION__?: string`
- `__LIB_VERSION__?: string`
- `__FW_VERSION__?: string`

These are declared as optional globals because unit tests may intentionally omit them to exercise fallback paths.

## Invariants & Assumptions

- Build metadata values are injected by Vite `define` in [config/vite.config.ts](../config/vite.config.ts.md).
- Playwright hooks are only assigned in dev builds, not production builds.
- This file must stay a module (`export {}`) so the `declare global` block augments the global scope correctly.

## Tests

- `main.test.ts`, `main.replay-wiring.test.ts`, and Playwright specs rely on the `Window` hook declarations.
- `build-info.test.ts` and related UI/recording tests rely on the optional build metadata globals.

## Related

- [utils/build-info.ts](utils/build-info.ts.md)
- [2026-04-20-zip-debug-metadata-plan.md](../../../gps-plus-slam/GpsPlusSlamJs_Docs/docs/2026-04-20-zip-debug-metadata-plan.md)
