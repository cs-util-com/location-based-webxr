# e2e-hooks.ts

## Purpose

The Playwright `window.testHooks` surface plus the map-browser fixture builders, extracted from `main.ts` (2026-07-11 lifecycle-scope plan, step 3) so the production entry file carries no fixture scaffolding. Playwright tests call real app functions through these hooks instead of simulating DOM changes.

## Public API

- `installE2eTestHooks(deps: E2eHookDeps): void` — assigns `window.testHooks` as ONE object literal. `deps.ensureMapBrowserRoot` is injected from `main.ts` and implemented in [ui/map-browser-launcher.ts](../ui/map-browser-launcher.ts.md) (the same full-bleed root container the real replay path uses). `deps.getStore` / `deps.setStore` give the hooks main.ts's current store and its store swap (which also updates `storeRef`).
- `startRecordingWithoutAr` / `stopRecordingWithoutAr` hooks: Playwright has no WebXR session, so the first builds a fresh recorder store on a `NullStorageBackend` (it writes nothing), dispatches the real `startSession`, swaps it in and shows the RECORDING controls; every HUD tap after that runs the real handler against the real store. The second dispatches `endSession` and shows the summary built by the real `buildSessionSummary` from the store's slices, with the AR-only inputs (GPS, odometry, images, zip) empty. Used by `phase-marker.spec.js`.

## Invariants & assumptions

- **Key-set contract:** the `window.testHooks` keys are pinned bidirectionally against `REQUIRED_TEST_HOOKS` in `playwright-tests/test-helpers.js`; the coverage-guard spec (`test-hooks-verification.spec.js`) fails within seconds naming any drifted hook. Add/remove keys in BOTH places in the same commit.
- Loaded ONLY via the guarded dynamic import at the bottom of `main.ts` (`import.meta.env.DEV && !VITEST`), so the module never reaches production bundles or the unit-test module graph. Playwright's `waitForTestHooks` polls for the hooks, so the async install is invisible to specs.
- The map-browser fixtures write Playwright-visible state to `window.__mapBrowserPlayed` / `__mapBrowserInstance` / `__mapBrowserBackfillCalls` / `__releaseBackfill` (typed in `src/global.d.ts`).
- `fixtureToRecordingCoverage` fabricates `RecordingCoverage` entries with a dummy `FileSystemFileHandle` — fixture tours are never opened as files.

## Examples

```ts
// main.ts (the only caller):
if (
  import.meta.env.DEV &&
  typeof window !== 'undefined' &&
  !import.meta.env.VITEST
) {
  void import('./test-utils/e2e-hooks').then(({ installE2eTestHooks }) =>
    installE2eTestHooks({ ensureMapBrowserRoot })
  );
}
```

## Tests

- Exercised end-to-end by the whole Playwright suite (every spec goes through `waitForTestHooks`); the hook/key contract is verified by `playwright-tests/test-hooks-verification.spec.js`.
