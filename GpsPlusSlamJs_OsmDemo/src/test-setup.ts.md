# `test-setup.ts`

## Purpose

Process-wide vitest setup file for the OSM demo, loaded through
`vitest.config.ts#test.setupFiles` and run for its side effect only: the
Node 26 storage shim for the jsdom-annotated test files. Node 26 makes the
global `localStorage` accessor throw without `--localstorage-file`, and
vitest 4's jsdom environment then leaves the global `localStorage`
undefined; `ar-hud.test.ts` and `ar-mode.test.ts` were the first reds here
under Node 26 (harness-majors plan M0, 2026-09-07).

## Public API

None.

## Invariants & assumptions

- **Guarded:** installs only when `window` exists (a jsdom file) and the
  global storage is unusable; the read is inside a try because on a bare
  Node 26 the read is what throws. The node environment is untouched.
- **Installs jsdom's real `Storage` class as the global one**, together with
  the storages of a fresh JSDOM at the environment's URL, so a test's
  `vi.spyOn(Storage.prototype, …)` intercepts the objects in use. A plain
  in-memory object would satisfy reads and writes and silently defeat the
  spies.
- **A deliberate copy** of the recorder's `src/test-setup.ts` shim (DEC-H3):
  this package consumes the published framework, so a shared test utility
  is only reachable with the framework's next release. Follow-up:
  `GpsPlusSlamJs_Docs/docs/2026-09-07-2020-node-26-storage-shim-copies-followup.md`.
- **Test-only:** excluded from the production type-check and from coverage;
  never imported by production code.
- **When it can go:** when vitest's jsdom environment restores the storage
  globals under Node 26 (or on Vitest 5, to be checked in the plan's M1).

## Examples

Loaded automatically. The proof is `src/ar-hud.test.ts` and
`src/ar-mode.test.ts` passing under Node 26.

## Tests

No dedicated test; the two jsdom suites above are its proof.
