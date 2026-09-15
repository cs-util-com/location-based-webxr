# `alignment-timing-main.ts` - the entry point

## Purpose

The browser entry of `alignment-timing.html`. Supplies the real dependencies to
`wireAlignmentTimingPage` and does nothing else.

## Public API

None. It is a side-effecting module script, loaded by
`alignment-timing.html` only.

## Invariants and assumptions

- **Not reachable from the recorder.** Nothing in `src/` outside `src/timing/`
  imports it, and no page links to `alignment-timing.html`;
  `alignment-timing-isolation.test.ts` asserts both.
- **The store is the app's own** (`createRecorderStore`), so the measured
  per-fix cost includes the dispatch machinery the app really pays around the
  solve. Three deviations, each deliberate:
  - `NullStorageBackend` - the page never starts a recording session, so the
    persistence middleware short-circuits anyway; the null backend makes that
    true by construction.
  - `enableDevChecks: false` - matches a production build. Left on, a dev-server
    run measures the deep-equality dev middleware instead of the solve.
  - the three compass opt-ins OFF - otherwise the framework auto-enables one on
    the first session zero and every arm runs under a configuration none of them
    declared. Replay mode disables them for the same reason.
- **The recording loader is the app's canonical one** (`storage/recording-loader`),
  the same call replay mode makes. No second loader exists.
- Build metadata (`__APP_VERSION__`, `__LIB_VERSION__`, `__FW_VERSION__`,
  `__BUILD_COMMIT__`) is injected by the bundler and falls back to `'dev'`.

## Example

Open `/alignment-timing.html` on the device (on a deployed branch preview,
`<branch>-gps-plus-slam.<host>/recorder/alignment-timing.html`), choose a
recording zip, press **Run timing**, copy the JSON.

## Tests

No unit tests of its own - it is dependency wiring, and every behaviour it wires
is covered in `alignment-timing-page.test.ts`. The built page is smoke-covered
by `playwright-tests/alignment-timing.spec.js`, which is what would catch a
module that throws on load or an entry the bundler does not build.
