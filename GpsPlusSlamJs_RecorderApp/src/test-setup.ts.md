# `test-setup.ts`

## Purpose

Process-wide vitest setup file for the recorder, loaded through
`config/vitest.config.ts#test.setupFiles` and run for its side effect only:
a guarded `Blob.prototype.stream()` polyfill for the jsdom-annotated test
files. `@zip.js/zip.js` 2.9+ reads a `BlobReader`'s source through
`blob.stream()` (2.8 sliced and called `arrayBuffer()`); every browser has
`Blob.prototype.stream`, jsdom's `Blob` does not — so the day zip.js moved to
2.11 (dependency sweep 2026-09-07) the jsdom tests that push a Blob through
the framework's zip export failed with "sourceBlob.stream is not a function".

## Public API

None.

## Invariants & assumptions

- **Guarded:** installed only where `Blob.prototype.stream` is not a
  function. Setup files run inside each test file's own environment, so the
  guard sees jsdom's `Blob` for a `@vitest-environment jsdom` file and Node's
  (which has `stream()`) for the package default; the node case installs
  nothing. A jsdom that gains `stream()` wins automatically.
- **Reads through `slice()` in 64 KB chunks, never through the blob's own
  `arrayBuffer()`.** A browser's `stream()` does not buffer the whole blob
  either, and `src/storage/recording-discovery.test.ts` patches
  `arrayBuffer` on a File INSTANCE to prove the scenario scanner never loads
  a recording whole — a polyfill that called `this.arrayBuffer()` would trip
  that spy and invert the test's meaning.
- **No storage shim any more.** Node 26 makes the global `localStorage`
  accessor throw without `--localstorage-file`, and vitest 4's jsdom
  environment then left it undefined (the six help-section persistence tests
  in `src/ui/hud.test.ts` were the first CI red under 26, PR #431); a
  JSDOM-based shim lived here from r657 to r659. Vitest 5's jsdom environment
  restores the storage globals itself - proven by running `hud.test.ts`
  under Node 26.8.1 with the shim disabled (128 green) - so the shim is gone
  (harness-majors plan M1).
- **Test-only:** excluded from `tsconfig.app.json` and from coverage; never
  imported by production code (browsers need no polyfill).
- **When it can go:** the moment jsdom ships `Blob.prototype.stream`, or the
  recorder's jsdom tests stop reading Blobs through zip.js. Check on every
  zip.js or jsdom bump; the guard makes an obsolete polyfill harmless, not
  invisible.

## Examples

Loaded automatically. The proof is `src/storage/scenario-zip-export.test.ts`
and `src/storage/recording-discovery.test.ts` passing under jsdom with
zip.js ≥ 2.9.

## Tests

No dedicated test; the two jsdom suites above are its proof (PR #428 and
#429 reviews asked for this sidecar, matching the framework's
`src/test-setup.ts.md`).
