# e2e-hooks.ts

## Purpose

The Playwright `window.testHooks` surface plus the map-browser fixture builders, extracted from `main.ts` (2026-07-11 lifecycle-scope plan, step 3) so the production entry file carries no fixture scaffolding. Playwright tests call real app functions through these hooks instead of simulating DOM changes.

## Public API

- `installE2eTestHooks(deps: E2eHookDeps): void` — assigns `window.testHooks` as ONE object literal. `deps.ensureMapBrowserRoot` is injected from `main.ts` and implemented in [ui/map-browser-launcher.ts](../ui/map-browser-launcher.ts.md) (the same full-bleed root container the real replay path uses).

## Invariants & assumptions

- **Key-set contract:** the `window.testHooks` keys are pinned bidirectionally against `REQUIRED_TEST_HOOKS` in `playwright-tests/test-helpers.js`; the coverage-guard spec (`test-hooks-verification.spec.js`) fails within seconds naming any drifted hook. Add/remove keys in BOTH places in the same commit.
- Loaded ONLY via the guarded dynamic import at the bottom of `main.ts` (`import.meta.env.DEV && !VITEST`), so the module never reaches production bundles or the unit-test module graph. Playwright's `waitForTestHooks` polls for the hooks, so the async install is invisible to specs.
- The map-browser fixtures write Playwright-visible state to `window.__mapBrowserPlayed` / `__mapBrowserInstance` / `__mapBrowserBackfillCalls` / `__releaseBackfill` (typed in `src/global.d.ts`).
- `fixtureToRecordingCoverage` fabricates `RecordingCoverage` entries with a dummy `FileSystemFileHandle` — fixture tours are never opened as files.
- **Offline scene fixture (`addGpsEventForTest`, §3c):** the hook keeps a module-level offline `THREE.Scene` + `arWorldGroup` (lazily created, reused across calls) and points `gpsEventVisualizer` at them via `setSceneSource` with a live-scene-first fallback (`getScene() ?? offlineScene`). It no longer injects the offline scene into the webxr-session singleton — those setters were deleted (2026-07-11 surface-reduction step 2). The source is re-asserted on every call so a replay session's own override/reset can't strand later fixture events.

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
